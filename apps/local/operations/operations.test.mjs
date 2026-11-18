import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createJobs, registerOperations } from '../operations.mjs'
import { backupProfile, checkBackup, restoreBackup } from './backup.mjs'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ledger-operations-'))
  const db = new DatabaseSync(join(dir, 'ledger.sqlite'))
  db.exec('PRAGMA journal_mode=WAL')
  const profile = { db, dir, mode: 'demo' },
    jobs = createJobs()
  t.after(async () => {
    await jobs.shutdown()
    db.close()
    await rm(dir, { recursive: true, force: true })
  })
  return { profile, jobs }
}

test('failed demo attempt, redacted history, pause/resume and retry preserve logical identity', async (t) => {
  const { profile, jobs } = await setup(t)
  const routes = new Map()
  const app = {
    get: (p, h) => routes.set(p, h),
    post: (p, h) => routes.set(p, h),
    addHook() {},
  }
  registerOperations(app, { jobs, profile: () => profile })
  const endpoint = routes.get('/api/v1/jobs/:name/:action')
  const request = (action) => ({ params: { name: 'demo.diagnostic', action } })
  await assert.rejects(endpoint(request('run')), /Demo source unavailable/)
  const failed = jobs.list(profile).find((j) => j.name === 'demo.diagnostic')
  assert.equal(failed.last.status, 'failed')
  assert.equal(failed.canRetry, true)
  await endpoint(request('pause'))
  await assert.rejects(endpoint(request('run')), /paused/)
  await endpoint(request('resume'))
  await endpoint({ ...request('retry'), body: { runId: failed.last.id } })
  const [retry, original] = jobs.history(profile, { name: failed.name })
  assert.notEqual(retry.id, original.id)
  assert.equal(retry.status, 'succeeded')
  assert.equal(retry.retryOf, original.id)
  assert.equal(retry.logicalKey, original.logicalKey)
  assert.equal(
    jobs.logs(profile, { runId: original.id, level: 'error' }).length,
    1,
  )
  assert(jobs.list(profile).find((j) => j.name === failed.name).lastSuccess)
  assert(
    !jobs
      .list({ ...profile, mode: 'live' })
      .some((j) => j.name === 'demo.diagnostic'),
  )
  assert.equal(jobs.history(profile, { before: retry.seq })[0].id, original.id)
})

test('one leased owner, bounded Console records, replay and retry-safe arguments', async (t) => {
  const { profile, jobs } = await setup(t)
  let release
  const wait = new Promise((r) => {
    release = r
  })
  jobs.register(
    'test.slow',
    async ({ log, checkpoint, finishAs }) => {
      log(
        'Authorization: Bearer abcdef; path C:\\Users\\private\\account.lua',
        'info',
        { processed: 3, total: 3, stage: 'Checking' },
      )
      await wait
      checkpoint('hour 42')
      finishAs('no-change', 'Current revision already present')
      return 42
    },
    { manual: true },
  )
  const events = []
  const off = jobs.subscribe(profile, null, (e) => events.push(e))
  const first = jobs.run('test.slow', profile)
  const second = createJobs()
  second.register('test.slow', () => {})
  await assert.rejects(second.run('test.slow', profile), /already running/i)
  release()
  assert.equal(await first, 42)
  off()
  const item = jobs.list(profile)[0]
  assert.equal(item.last.processed, 3)
  assert.equal(item.cursor, 'hour 42')
  assert.equal(item.last.status, 'no-change')
  const text = JSON.stringify(jobs.logs(profile, {}))
  assert(!/abcdef|private|account\.lua/.test(text))
  const replay = []
  jobs.subscribe(profile, events[1].cursor, (e) => replay.push(e))()
  assert.deepEqual(
    replay.slice(0, -1).map((e) => e.cursor),
    events.slice(2).map((e) => e.cursor),
  )
  const reset = []
  jobs.subscribe(profile, 999999, (e) => reset.push(e))()
  assert.equal(reset[0].kind, 'reset')
  jobs.register(
    'test.secret',
    async () => {
      throw Error('Access denied')
    },
    { retry: true },
  )
  await assert.rejects(
    jobs.run('test.secret', profile, { token: 'hidden' }),
    /denied/,
  )
  assert.equal(
    jobs.list(profile).find((j) => j.name === 'test.secret').canRetry,
    false,
  )
  await second.shutdown()
})

test('expired durable lease is interrupted and a retained-event gap resynchronises', async (t) => {
  const { profile, jobs } = await setup(t)
  jobs.register('test.migrate', async () => {})
  await jobs.run('test.migrate', profile)
  profile.db.exec(
    "UPDATE ops_runs SET status='running',lease_until=0,ended=NULL",
  )
  const next = createJobs()
  next.register('test.migrate', async () => {})
  assert.equal(next.list(profile)[0].last.status, 'interrupted')
  await next.run('test.migrate', profile)
  profile.db.exec('DELETE FROM ops_events WHERE seq<4')
  const events = []
  next.subscribe(profile, 1, (e) => events.push(e))()
  assert.equal(events[0].kind, 'reset')
  await next.shutdown()
})

test('sleep resumes the live owner without starting a second handler', async (t) => {
  const { profile, jobs } = await setup(t)
  let release
  const gate = new Promise((r) => {
    release = r
  })
  let observedRegion
  profile.region = 'us'
  jobs.register('test.resume', async ({ profile: original, signal }) => {
    await gate
    observedRegion = original.region
    assert.equal(signal.aborted, false)
  })
  const task = jobs.run('test.resume', profile)
  profile.region = 'eu'
  profile.db.exec('UPDATE ops_runs SET lease_until=0')
  assert.equal(jobs.list(profile)[0].last.status, 'running')
  await assert.rejects(jobs.run('test.resume', profile), /already running/)
  release()
  await task
  assert.equal(jobs.history(profile).length, 1)
  assert.equal(observedRegion, 'us')
})

test('restoring an old archive expires live observations and orphan tiers but preserves synthetic data', async (t) => {
  const { profile } = await setup(t)
  const { db, dir } = profile
  db.exec(
    "CREATE TABLE market_snapshots(house TEXT,t INTEGER,source TEXT); CREATE TABLE market_details(house TEXT,t INTEGER); INSERT INTO market_snapshots VALUES('us-2-110',1,'auctionhouse.tk.gg'),('demo',1,'demo'); INSERT INTO market_details VALUES('us-2-110',1),('unseen-house',1),('demo',1)",
  )
  db.prepare(
    "INSERT INTO market_snapshots VALUES('us-2-110',?,'auctionhouse.tk.gg')",
  ).run(Date.now())
  const { id } = await backupProfile(profile)
  const destination = join(dir, 'clean.sqlite')
  await restoreBackup(join(dir, 'backups', id), destination)
  const restored = new DatabaseSync(destination)
  try {
    assert.equal(
      restored.prepare('SELECT COUNT(*) AS n FROM market_snapshots').get().n,
      2,
    )
    assert.equal(
      restored
        .prepare('SELECT group_concat(house) AS names FROM market_details')
        .get().names,
      'demo',
    )
  } finally {
    restored.close()
  }
})

test('retained logs and events remain bounded after a burst', async (t) => {
  const { profile, jobs } = await setup(t)
  jobs.register('test.retention', async ({ log }) => log('Final item'))
  jobs.list(profile)
  profile.db.exec(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<5000) INSERT INTO ops_logs(run_id,name,time,level,source,message) SELECT 'old','test.retention',0,'info','fixture','Prior item' FROM n",
  )
  profile.db.exec(
    "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2048) INSERT INTO ops_events(event) SELECT '{}' FROM n",
  )
  await jobs.run('test.retention', profile)
  assert.equal(
    profile.db.prepare('SELECT COUNT(*) AS n FROM ops_logs').get().n,
    5000,
  )
  assert.equal(
    profile.db.prepare('SELECT COUNT(*) AS n FROM ops_events').get().n,
    2048,
  )
  assert.equal(jobs.logs(profile, { limit: 9000 }).length, 200)
  const [a, b] = jobs.logs(profile, { limit: 2 })
  assert.equal(jobs.logs(profile, { before: a.seq, limit: 1 })[0].seq, b.seq)
})

test('consistent WAL backup and isolated recovery preserve personal rows and run migration and expiry hooks', async (t) => {
  const { profile } = await setup(t)
  profile.db.exec(
    "CREATE TABLE lots(id TEXT); INSERT INTO lots VALUES('synthetic-lot'); CREATE TABLE notes(t TEXT); INSERT INTO notes VALUES('hold'); CREATE TABLE layout(name TEXT); INSERT INTO layout VALUES('Four panes'); CREATE TABLE cache(data TEXT); INSERT INTO cache VALUES('expired'); PRAGMA user_version=2",
  )
  const backup = await backupProfile(profile)
  profile.db.exec("INSERT INTO lots VALUES('later transaction')")
  assert(backup.bytes > 0)
  const dest = join(profile.dir, 'restored.sqlite')
  const hooks = {
    migrate(db) {
      db.exec('PRAGMA user_version=3')
    },
    expire(db) {
      db.exec('DELETE FROM cache')
    },
  }
  assert.equal((await checkBackup(profile, backup.id, hooks)).schema, 3)
  const file = join(profile.dir, 'backups', backup.id)
  await restoreBackup(file, dest, hooks)
  const db = new DatabaseSync(dest, { readOnly: true })
  try {
    assert.equal(
      db.prepare('SELECT group_concat(id) AS result FROM lots').get().result,
      'synthetic-lot',
    )
    assert.equal(db.prepare('SELECT t FROM notes').get().t, 'hold')
    assert.equal(db.prepare('SELECT name FROM layout').get().name, 'Four panes')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cache').get().n, 0)
  } finally {
    db.close()
  }
  await assert.rejects(restoreBackup(file, dest, hooks))
  await assert.rejects(checkBackup(profile, '../ledger.sqlite', hooks))
  const corrupt = join(profile.dir, 'corrupt.sqlite')
  await writeFile(corrupt, 'invalid bytes')
  await assert.rejects(
    restoreBackup(corrupt, join(profile.dir, 'failed.sqlite'), hooks),
  )
  await assert.rejects(
    readFile(join(profile.dir, 'failed.sqlite')),
    (e) => e.code === 'ENOENT',
  )
})
