import { createHash, randomUUID } from 'node:crypto'

const MAX_LOGS = 5000
const MAX_EVENTS = 2048
const MAX_RUNS = 1000
const LEASE_MS = 90_000
const levels = new Set(['debug', 'info', 'warn', 'error'])
const terminalSuccess = ['succeeded', 'no-change', 'partial']

export function diagnosticText(value) {
  return String(value ?? '')
    .replace(/\b(Bearer|Basic)\s+[\w+/=.-]+/gi, '$1 [redacted]')
    .replace(
      /\b(authorization|api[-_]?key|token|password|secret|account(?:name)?|character(?:name)?)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&,;]+)/gi,
      '$1=[redacted]',
    )
    .replace(/(?:\b[a-z]:[\\/]|\\\\)[^\r\n"'<>|]*/gi, '[local path]')
    .replace(/\/(?:home|Users)\/[^\s]+/g, '[local path]')
    .replace(/https?:\/\/[^\s)]+/gi, (raw) => {
      try {
        const u = new URL(raw)
        return u.origin + u.pathname
      } catch {
        return '[url]'
      }
    })
    .slice(0, 1200)
}

export function jobError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode })
}

function cleanCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function cursorLimit(value, fallback, maximum) {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? Math.min(maximum, n) : fallback
}

function runView(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    stage: row.stage,
    processed: row.processed,
    total: row.total,
    startedAt: row.started,
    endedAt: row.ended,
    durationMs: (row.ended ?? Date.now()) - row.started,
    retryOf: row.retry_of,
    logicalKey: row.logical_key,
    message: row.summary,
    exitCode: row.exit_code,
    leaseUntil: row.lease_until,
    heartbeatAt: row.heartbeat,
  }
}

export function createJobs() {
  const registry = new Map()
  const known = new Map()
  const pending = new Set()
  let closing = false

  function state(profile) {
    const db = profile.db
    if (known.has(db)) return known.get(db)
    db.exec(
      'CREATE TABLE IF NOT EXISTS ops_runs (' +
        'id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, logical_key TEXT NOT NULL,' +
        'started INTEGER NOT NULL, ended INTEGER, retry_of TEXT, stage TEXT NOT NULL, processed INTEGER, total INTEGER,' +
        'summary TEXT, exit_code INTEGER, heartbeat INTEGER, lease_until INTEGER, replay_safe INTEGER NOT NULL);' +
        "CREATE UNIQUE INDEX IF NOT EXISTS ops_lease ON ops_runs(name) WHERE status='running';" +
        'CREATE INDEX IF NOT EXISTS ops_history ON ops_runs(name,started DESC);' +
        'CREATE TABLE IF NOT EXISTS ops_logs (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,' +
        'name TEXT NOT NULL, time INTEGER NOT NULL, level TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,stage TEXT);' +
        'CREATE INDEX IF NOT EXISTS ops_log_run ON ops_logs(run_id,seq);' +
        'CREATE TABLE IF NOT EXISTS ops_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS ops_control(name TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0,next_at INTEGER,cursor TEXT);',
    )
    const s = { db, listeners: new Set(), active: new Map() }
    known.set(db, s)
    recover(s, profile.mode)
    return s
  }

  function emit(s, body) {
    const row = s.db
      .prepare('INSERT INTO ops_events(event) VALUES(?)')
      .run(JSON.stringify(body))
    const cursor = Number(row.lastInsertRowid)
    s.db.prepare('DELETE FROM ops_events WHERE seq<=?').run(cursor - MAX_EVENTS)
    for (const listener of s.listeners) {
      try {
        listener({ ...body, cursor })
      } catch {
        s.listeners.delete(listener)
      }
    }
  }

  function recover(s, mode) {
    const time = Date.now()
    for (const [id, controller] of s.active) {
      const row = s.db
        .prepare('SELECT status,lease_until FROM ops_runs WHERE id=?')
        .get(id)
      if (row?.status !== 'running') controller.abort()
      else if (row.lease_until <= time) {
        // Windows sleep suspends the heartbeat of a healthy worker.
        s.db
          .prepare(
            "UPDATE ops_runs SET heartbeat=?,lease_until=? WHERE id=? AND status='running'",
          )
          .run(time, time + LEASE_MS, id)
      }
    }
    const stale = s.db
      .prepare(
        "UPDATE ops_runs SET status='interrupted',stage='Interrupted',ended=?,lease_until=NULL,summary='Worker lease expired' WHERE status='running' AND lease_until<=? RETURNING id,name",
      )
      .all(time, time)
    for (const run of stale)
      emit(s, {
        kind: 'run',
        job: run.name,
        runId: run.id,
        mode,
        status: 'interrupted',
      })
  }

  function register(name, handler, options = {}) {
    if (
      !/^[a-z][a-z0-9.-]{0,79}$/.test(name) ||
      registry.has(name) ||
      typeof handler !== 'function'
    ) {
      throw Error('Invalid or duplicate job name: ' + name)
    }
    registry.set(name, {
      name,
      handler,
      description: options.description || name,
      source: options.source || 'local',
      modes: options.modes || ['live', 'demo'],
      manual: options.manual === true,
      retry: options.retry === true,
    })
  }

  async function run(name, profile, payload, options = {}) {
    // A region switch affects future work; this attempt keeps the original house.
    profile = { ...profile }
    const entry = registry.get(name)
    if (!entry || !entry.modes.includes(profile.mode))
      throw jobError('Unknown job', 404)
    if (closing) throw jobError('Service is shutting down', 503)
    const s = state(profile),
      db = s.db
    recover(s, profile.mode)
    if ([...s.active.values()].some((c) => c.jobName === name))
      throw jobError('Job already running', 409)
    if (
      db.prepare('SELECT paused FROM ops_control WHERE name=?').get(name)
        ?.paused
    )
      throw jobError('Job is paused. Resume it in Console.', 409)
    const id = randomUUID(),
      time = Date.now(),
      mode = profile.mode
    const logicalKey = options.logicalKey
      ? createHash('sha256')
          .update(name + '\n' + String(options.logicalKey))
          .digest('hex')
          .slice(0, 24)
      : options.previousKey || id
    // The database's unique active lease also serialises separate local processes.
    db.exec('BEGIN IMMEDIATE')
    try {
      if (
        db
          .prepare("SELECT id FROM ops_runs WHERE name=? AND status='running'")
          .get(name)
      )
        throw jobError('Job already running', 409)
      db.prepare(
        "INSERT INTO ops_runs(id,name,status,logical_key,started,retry_of,stage,heartbeat,lease_until,replay_safe) VALUES(?,?,'running',?,?,?,'Starting',?,?,?)",
      ).run(
        id,
        name,
        logicalKey,
        time,
        options.retryOf ?? null,
        time,
        time + LEASE_MS,
        Number(payload == null),
      )
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    const controller = new AbortController()
    controller.jobName = name
    s.active.set(id, controller)
    emit(s, { kind: 'run', job: name, runId: id, mode, status: 'running' })
    function log(message, level = 'info', details = {}) {
      if (!s.active.has(id)) return
      const stage = details.stage
        ? diagnosticText(details.stage).slice(0, 80)
        : null
      const now = Date.now()
      db.prepare(
        "UPDATE ops_runs SET stage=COALESCE(?,stage),processed=COALESCE(?,processed),total=COALESCE(?,total),heartbeat=?,lease_until=? WHERE id=? AND status='running'",
      ).run(
        stage,
        cleanCount(details.processed),
        cleanCount(details.total),
        now,
        now + LEASE_MS,
        id,
      )
      const { lastInsertRowid } = db
        .prepare(
          'INSERT INTO ops_logs(run_id,name,time,level,source,message,stage) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          id,
          name,
          now,
          levels.has(level) ? level : 'info',
          diagnosticText(details.source || entry.source),
          diagnosticText(message),
          stage,
        )
      db.prepare('DELETE FROM ops_logs WHERE seq<=?').run(
        Number(lastInsertRowid) - MAX_LOGS,
      )
      emit(s, { kind: 'log', job: name, runId: id, mode })
    }
    let outcome = 'succeeded',
      summary = '',
      cursor
    const heartbeat = setInterval(() => {
      try {
        const now = Date.now()
        const owner = db
          .prepare(
            "UPDATE ops_runs SET heartbeat=?,lease_until=? WHERE id=? AND status='running'",
          )
          .run(now, now + LEASE_MS, id)
        if (!owner.changes) controller.abort()
      } catch (error) {
        if ((error.errcode & 255) !== 5 && error.code !== 'SQLITE_BUSY')
          controller.abort()
      }
    }, 20_000)
    heartbeat.unref()
    const task = (async () => {
      try {
        log('Started', 'info', { stage: 'Running' })
        const result = await entry.handler({
          profile,
          payload,
          signal: controller.signal,
          runId: id,
          log,
          checkpoint(value) {
            cursor = diagnosticText(value).slice(0, 180)
          },
          nextAt(value) {
            schedule(name, profile, value)
          },
          finishAs(status, message) {
            if (!terminalSuccess.includes(status))
              throw Error('Invalid completion status')
            outcome = status
            summary = diagnosticText(message)
          },
        })
        controller.signal.throwIfAborted()
        log(summary || 'Completed', outcome === 'partial' ? 'warn' : 'info')
        return result
      } catch (error) {
        outcome = controller.signal.aborted ? 'interrupted' : 'failed'
        summary = diagnosticText(error?.message || error)
        log(summary, 'error')
        throw jobError(
          summary,
          Number.isInteger(error?.statusCode) ? error.statusCode : 500,
        )
      } finally {
        clearInterval(heartbeat)
        const ended = Date.now()
        s.active.delete(id)
        const change = db
          .prepare(
            "UPDATE ops_runs SET status=?,ended=?,lease_until=NULL,summary=?,stage=?,exit_code=? WHERE id=? AND status='running'",
          )
          .run(
            outcome,
            ended,
            summary || null,
            outcome === 'failed'
              ? 'Failed'
              : outcome === 'interrupted'
                ? 'Interrupted'
                : 'Complete',
            outcome === 'failed' ? 1 : outcome === 'interrupted' ? null : 0,
            id,
          )
        if (change.changes) {
          if (cursor != null && terminalSuccess.includes(outcome))
            db.prepare(
              'INSERT INTO ops_control(name,cursor) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor',
            ).run(name, cursor)
          emit(s, { kind: 'run', job: name, runId: id, mode, status: outcome })
        }
        db.prepare(
          "DELETE FROM ops_runs WHERE id IN (SELECT id FROM ops_runs WHERE status!='running' ORDER BY started DESC,rowid DESC LIMIT -1 OFFSET ?)",
        ).run(MAX_RUNS)
      }
    })()
    pending.add(task)
    try {
      return await task
    } finally {
      pending.delete(task)
    }
  }

  function schedule(name, profile, nextAt) {
    if (!registry.has(name)) throw jobError('Unknown job', 404)
    if (nextAt != null && !Number.isSafeInteger(nextAt))
      throw new TypeError('Invalid next run time')
    state(profile)
      .db.prepare(
        'INSERT INTO ops_control(name,next_at) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET next_at=excluded.next_at',
      )
      .run(name, nextAt ?? null)
  }

  function list(profile) {
    const s = state(profile),
      db = s.db
    recover(s, profile.mode)
    return [...registry.values()]
      .filter((entry) => entry.modes.includes(profile.mode))
      .map((entry) => {
        const control = db
          .prepare('SELECT * FROM ops_control WHERE name=?')
          .get(entry.name)
        const last = db
          .prepare(
            'SELECT * FROM ops_runs WHERE name=? ORDER BY started DESC,rowid DESC LIMIT 1',
          )
          .get(entry.name)
        const success = db
          .prepare(
            "SELECT ended FROM ops_runs WHERE name=? AND status IN ('succeeded','no-change') ORDER BY ended DESC LIMIT 1",
          )
          .get(entry.name)
        return {
          name: entry.name,
          description: entry.description,
          source: entry.source,
          manual: entry.manual,
          canRetry: Boolean(
            entry.retry &&
            last?.replay_safe &&
            ['failed', 'interrupted', 'partial'].includes(last.status),
          ),
          paused: Boolean(control?.paused),
          nextAt: control?.next_at ?? null,
          cursor: control?.cursor ?? null,
          lastSuccess: success?.ended ?? null,
          last: runView(last),
        }
      })
  }

  async function control(profile, name, action, runId) {
    const entry = registry.get(name),
      s = state(profile)
    if (!entry || !entry.modes.includes(profile.mode))
      throw jobError('Unknown job', 404)
    if (action === 'pause' || action === 'resume') {
      s.db
        .prepare(
          'INSERT INTO ops_control(name,paused) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET paused=excluded.paused',
        )
        .run(name, Number(action === 'pause'))
      emit(s, { kind: 'control', job: name, mode: profile.mode })
    } else if (action === 'run' && entry.manual) {
      await run(name, profile)
    } else if (action === 'retry' && entry.retry) {
      const previous = s.db
        .prepare('SELECT * FROM ops_runs WHERE id=? AND name=?')
        .get(runId ?? '', name)
      if (
        !previous?.replay_safe ||
        !['failed', 'partial', 'interrupted'].includes(previous.status)
      )
        throw jobError('This attempt cannot be replayed', 409)
      await run(name, profile, undefined, {
        retryOf: previous.id,
        previousKey: previous.logical_key,
      })
    } else
      throw jobError(
        'Use the corresponding application action to run this job',
        400,
      )
    return { jobs: list(profile) }
  }

  function history(profile, { name, limit, before } = {}) {
    const args = [],
      conditions = []
    if (name) {
      conditions.push('name=?')
      args.push(name)
    }
    if (before) {
      conditions.push('rowid<?')
      args.push(Number(before) || 0)
    }
    return state(profile)
      .db.prepare(
        'SELECT rowid AS seq,* FROM ops_runs ' +
          (conditions.length ? 'WHERE ' + conditions.join(' AND ') : '') +
          ' ORDER BY rowid DESC LIMIT ?',
      )
      .all(...args, cursorLimit(limit, 50, 150))
      .map((r) => ({ ...runView(r), seq: r.seq }))
  }
  function logs(profile, { runId, name, level, source, before, limit } = {}) {
    const conditions = [],
      args = []
    for (const [column, value] of [
      ['run_id', runId],
      ['name', name],
      ['level', level],
      ['source', source],
    ])
      if (value) {
        conditions.push(column + '=?')
        args.push(value)
      }
    if (before) {
      conditions.push('seq<?')
      args.push(Number(before) || 0)
    }
    return state(profile)
      .db.prepare(
        'SELECT seq,run_id AS runId,name,time,level,source,message,stage FROM ops_logs ' +
          (conditions.length ? 'WHERE ' + conditions.join(' AND ') : '') +
          ' ORDER BY seq DESC LIMIT ?',
      )
      .all(...args, cursorLimit(limit, 80, 200))
  }

  function subscribe(profile, after, listener) {
    const s = state(profile),
      mode = profile.mode
    const { first, last } = s.db
      .prepare('SELECT MIN(seq) AS first, MAX(seq) AS last FROM ops_events')
      .get()
    const cursor = Number(after)
    if (after != null && after !== '' && after !== undefined) {
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor > (last ?? 0) ||
        cursor < (first ?? 1) - 1
      )
        listener({ cursor: last ?? 0, kind: 'reset', mode })
      else
        for (const row of s.db
          .prepare('SELECT * FROM ops_events WHERE seq>? ORDER BY seq')
          .all(cursor))
          listener({ ...JSON.parse(row.event), cursor: row.seq })
    }
    listener({ cursor: last ?? 0, kind: 'ready', mode })
    s.listeners.add(listener)
    return () => s.listeners.delete(listener)
  }

  async function shutdown() {
    closing = true
    for (const s of known.values()) for (const c of s.active.values()) c.abort()
    await Promise.allSettled([...pending])
  }
  return {
    register,
    run,
    list,
    control,
    history,
    logs,
    subscribe,
    schedule,
    shutdown,
  }
}
