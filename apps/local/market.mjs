import { Worker } from 'node:worker_threads'
import {
  HOUR,
  SOURCE,
  discoverHouse,
  normalizeOverview,
  normalizeDetail,
  normalizeRecipes,
  quoteLadder,
} from '../../packages/domain/market.mjs'
import {
  ensureStore,
  transaction,
  saveHouse,
  getHouse,
  latest,
  insertSnapshot,
  insertDetail,
  readDetail,
  saveCatalog,
} from './market-store.mjs'

import { registerCrosscheck } from './market-crosscheck.mjs'
import { houseOverview } from './market-overview.mjs'
const day = 24 * HOUR
const bad = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode })
const positive = (value, field, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw bad('Invalid ' + field)
  return n
}
const profileRegion = (p) => p.region ?? (p.mode === 'demo' ? 'us' : null)

async function request(
  path,
  signal,
  fetcher,
  { host = SOURCE, maxBytes = 32 * 1024 * 1024, headers } = {},
) {
  const timeout = AbortSignal.timeout(15_000)
  let res
  try {
    res = await fetcher('https://' + host + path, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'GoblinLedger local market reader',
      },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
  } catch (e) {
    throw new Error(
      'Market provider unavailable (' +
        (e.cause?.code ?? e.name) +
        '). Check the connection and the next attempt.',
    )
  }
  if (!res.ok) {
    const retry = res.headers.get('retry-after')
    const duration =
      retry &&
      (/^\d+$/.test(retry)
        ? Number(retry) * 1000
        : Date.parse(retry) - Date.now())
    const error = new Error(
      'Market provider returned HTTP ' +
        res.status +
        '.' +
        (retry ? ' Provider requested a retry delay.' : ''),
    )
    if (Number.isFinite(duration) && duration > 0) error.retryAfter = duration
    throw error
  }
  if (!res.headers.get('content-type')?.includes('json'))
    throw new Error('Market provider returned a non-JSON response.')
  const reader = res.body.getReader(),
    chunks = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maxBytes) {
      await reader.cancel()
      throw new Error('Market payload exceeded the download limit.')
    }
    chunks.push(Buffer.from(value))
  }
  headers?.(res.headers)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function nextAllowed(db, key) {
  return (
    db.prepare('SELECT next FROM market_cooldown WHERE key=?').get(key)?.next ??
    0
  )
}
export function getMarketNextAttempt(profile, name) {
  if (profile.mode !== 'live' || !['us', 'eu'].includes(profile.region))
    return null
  const key =
    name === 'market.refresh'
      ? 'bulk:' + profile.region
      : name === 'market.recipes'
        ? 'catalog'
        : null
  if (!key) return null
  ensureStore(profile)
  return nextAllowed(profile.db, key) || null
}
function reserve(db, key, until) {
  db.prepare('INSERT OR REPLACE INTO market_cooldown VALUES(?,?)').run(
    key,
    until,
  )
}
async function limited(db, key, interval, work) {
  const now = Date.now(),
    next = nextAllowed(db, key)
  if (next > now) return { held: true, next }
  reserve(db, key, now + interval)
  try {
    return { held: false, result: await work() }
  } catch (error) {
    if (error.retryAfter)
      reserve(db, key, Math.max(now + interval, Date.now() + error.retryAfter))
    throw error
  }
}

function requireRegion(profile) {
  ensureStore(profile)
  if (profile.mode !== 'live') throw bad('Demo uses the synthetic market.', 409)
  if (!['us', 'eu'].includes(profile.region))
    throw bad('Select the home region in Settings first.', 409)
}
async function publish(db, snapshot) {
  const file = db.location()
  if (!file || file === ':memory:')
    return transaction(db, () => insertSnapshot(db, snapshot))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./market-worker.mjs', import.meta.url), {
      workerData: { file, snapshot },
    })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0)
        reject(new Error('Snapshot writer exited with code ' + code))
    })
  })
}
export function getMarketSeries(profile, id, { before, after } = {}) {
  const house = getHouse(profile)
  if (!house) return []
  return profile.db
    .prepare(
      'SELECT r.data,s.retrieved FROM market_rows r JOIN market_snapshots s ON s.house=r.house AND s.t=r.t WHERE r.house=? AND r.id=? AND r.t>=? AND r.t<? ORDER BY r.t LIMIT 721',
    )
    .all(house.key, id, after ?? 0, before ?? Number.MAX_SAFE_INTEGER)
    .map((r) => ({ ...JSON.parse(r.data), retrievedAt: r.retrieved }))
}
export function getMarketItem(profile, id) {
  const house = getHouse(profile),
    snapshot = house && latest(profile.db, house.key)
  if (!snapshot) return null
  const item = profile.db
    .prepare('SELECT data FROM market_rows WHERE house=? AND id=? AND t=?')
    .get(house.key, id, snapshot.t)
  return item ? JSON.parse(item.data) : null
}
export function getMarketBook(profile, id) {
  const item = getMarketItem(profile, id),
    book = readDetail(profile, id)?.book
  return item &&
    book?.house === item.house &&
    book.t === item.t &&
    book.source === item.source
    ? book
    : null
}
export function marketQuote(profile, id, quantity) {
  return quoteLadder(getMarketBook(profile, id), quantity)
}

function envelope(profile, asOf) {
  const house = getHouse(profile)
  const snapshot =
    house &&
    (asOf === undefined
      ? latest(profile.db, house.key)
      : profile.db
          .prepare(
            'SELECT * FROM market_snapshots WHERE house=? AND t<=? AND retrieved<=? ORDER BY t DESC LIMIT 1',
          )
          .get(house.key, asOf, asOf))
  return {
    mode: profile.mode,
    region: profileRegion(profile),
    house: house?.key ?? null,
    snapshot: snapshot ?? null,
    source: profile.mode === 'demo' ? 'demo' : SOURCE,
    mapping:
      profile.mode === 'demo'
        ? 'Synthetic PvP Alliance house'
        : 'Provider-inferred PvP Alliance house. Item details offer a separate AHledger comparison with its own scan time.',
    status: !profileRegion(profile)
      ? 'choose-region'
      : !snapshot
        ? 'awaiting-snapshot'
        : 'observed',
    nextRefresh: nextAllowed(profile.db, 'bulk:' + profile.region) || null,
  }
}
function searchMarket(profile, query) {
  const info = envelope(profile)
  if (!info.snapshot) return { ...info, items: [], count: 0 }
  const q = String(query.q ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 150)
  const where = ['house=?', 't=?'],
    args = [info.house, info.snapshot.t]
  if (q) {
    where.push(`(instr(lower(name),?)>0 OR instr(lower(category),?)>0 OR CAST(id AS TEXT)=?
      OR id IN (SELECT item FROM market_recipe_uses WHERE instr(lower(name || ' ' || profession),?)>0)
      OR (id=940 AND instr('reduces spell mana costs',?)>0))`)
    args.push(q, q, q, q, q)
  }
  const sorts = {
    name: 'name COLLATE NOCASE',
    ask: 'ask',
    listed: 'listed',
    sold: 'sold',
  }
  const sort = Object.hasOwn(sorts, query.sort) ? sorts[query.sort] : sorts.name
  const direction = query.direction === 'desc' ? 'DESC' : 'ASC'
  const offset = Number(query.offset ?? 0)
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw bad('Invalid page offset')
  const limit = positive(query.limit ?? 50, 'page size', 100)
  const filter = where.join(' AND ')
  const count = profile.db
    .prepare('SELECT count(*) as count FROM market_rows WHERE ' + filter)
    .get(...args).count
  const rows = profile.db
    .prepare(
      'SELECT data FROM market_rows WHERE ' +
        filter +
        ' ORDER BY ' +
        sort +
        ' ' +
        direction +
        ' NULLS LAST,id LIMIT ? OFFSET ?',
    )
    .all(...args, limit, offset)
  return { ...info, count, items: rows.map((r) => JSON.parse(r.data)) }
}
export function registerMarket(app, ctx) {
  const fetcher = ctx.marketFetch ?? globalThis.fetch
  registerCrosscheck(app, ctx, (path, signal, options) =>
    request(path, signal, fetcher, options),
  )
  let queue = Promise.resolve(),
    queued = 0
  const pending = new Map()

  function queueDetail(profile, id) {
    const pinned = { ...profile }
    const key = profile.mode + ':' + profile.region + ':' + id
    if (pending.has(key)) return pending.get(key)
    if (queued >= 8)
      throw bad('The detail queue is full. Try again later.', 429)
    queued++
    const task = queue.then(() => ctx.jobs.run('market.detail', pinned, { id }))
    queue = task.catch(() => undefined)
    const tracked = task.finally(() => {
      pending.delete(key)
      queued--
    })
    pending.set(key, tracked)
    return tracked
  }
  ctx.jobs.register(
    'market.detail',
    async ({ profile, payload, log, signal, finishAs }) => {
      requireRegion(profile)
      const { id } = payload ?? {}
      positive(id, 'item id')
      const house = getHouse(profile),
        item = getMarketItem(profile, id)
      if (!house || !item)
        throw bad('Collect this house before requesting a listed item.', 409)
      if (getMarketBook(profile, id)) {
        finishAs?.('no-change', 'Book already available')
        return { cached: true }
      }
      const key = house.key + ':' + id
      try {
        const gate = 'detail:' + key
        const globalUntil = nextAllowed(
          profile.db,
          'detail-backoff:' + house.key,
        )
        if (globalUntil > Date.now())
          throw bad('The detail source is in backoff.', 429)
        log('Checking current item history and price tiers')
        const limitedResult = await limited(
          profile.db,
          gate,
          HOUR,
          async () => {
            const data = await request(
              '/api/m/' + house.key + '/item/' + id + '?hours=24',
              signal,
              fetcher,
            )
            const detail = normalizeDetail(data, house, id)
            transaction(profile.db, () => insertDetail(profile.db, detail))
            return {
              hours: detail.history.length,
              levels: detail.book.levels.length,
              bookTime: detail.book.t,
            }
          },
        )
        if (limitedResult.held)
          finishAs?.(
            'no-change',
            'Recent detail request is cached or cooling down',
          )
        return limitedResult
      } catch (error) {
        if (error.retryAfter)
          reserve(
            profile.db,
            'detail-backoff:' + house.key,
            Date.now() + error.retryAfter,
          )
        throw error
      }
    },
    {
      description: 'Targeted hourly history and price tiers',
      source: SOURCE,
      modes: ['live'],
    },
  )

  ctx.jobs.register(
    'market.refresh',
    async ({ profile, log, signal, finishAs, nextAt, checkpoint }) => {
      requireRegion(profile)
      const key = 'bulk:' + profile.region
      nextAt?.(Math.max(Date.now() + HOUR, nextAllowed(profile.db, key)))
      let result
      try {
        result = await limited(profile.db, key, HOUR, async () => {
          log('Discovering the selected PvP Alliance house')
          const discovery = await request('/api/markets', signal, fetcher)
          const house = discoverHouse(discovery, profile.region)
          saveHouse(profile.db, house)
          if (house.snapshot === null) {
            finishAs?.('no-change', 'House has no first snapshot')
            return { state: 'waiting' }
          }
          log('Reading the bulk overview')
          const raw = await request('/api/m/' + house.key, signal, fetcher)
          const snapshot = normalizeOverview(raw, house)
          if (!snapshot) {
            finishAs?.('no-change', 'House has no first snapshot')
            return { state: 'waiting' }
          }
          log(
            'Validating and scanning ' + snapshot.items.length + ' market rows',
          )
          const changed = await publish(profile.db, snapshot)
          if (!changed)
            finishAs?.('no-change', 'Latest snapshot already published')
          checkpoint?.(house.key + '/' + snapshot.t)
          log(
            'Published snapshot ' + new Date(snapshot.t).toISOString(),
            'info',
            { processed: snapshot.items.length, stage: 'published' },
          )
          // Inspect just one promising unresolved floor per new house snapshot.
          const pick =
            changed &&
            snapshot.items.find(
              (r) =>
                r.commodity &&
                r.ask > 0 &&
                r.ask === r.sell &&
                r.listed >= 100 &&
                (r.ask2 == null ||
                  BigInt(r.ask2) * 100n <= BigInt(r.ask) * 105n),
            )
          if (pick) void queueDetail(profile, pick.id).catch(() => {})
          return {
            state: changed ? 'published' : 'unchanged',
            house: house.key,
            t: snapshot.t,
            count: snapshot.items.length,
          }
        })
      } finally {
        nextAt?.(nextAllowed(profile.db, key))
      }
      if (result.held) finishAs?.('no-change', 'Hourly provider cooldown')
      return result
    },
    {
      manual: true,
      retry: true,
      source: SOURCE,
      modes: ['live'],
      description:
        'Discover house, publish its hourly overview and scan opportunities',
    },
  )

  ctx.jobs.register(
    'market.recipes',
    async ({ profile, log, signal, finishAs, nextAt }) => {
      requireRegion(profile)
      const db = profile.db
      const key = 'catalog'
      const result = await limited(db, key, HOUR, async () => {
        log('Fetching the profession catalog')
        let responseHeaders
        const catalog = normalizeRecipes(
          await request('/api/recipes', signal, fetcher, { headers: h => { responseHeaders = h } }),
        )
        saveCatalog(db, catalog, Date.now(), responseHeaders)
        reserve(db, key, Date.now() + 7 * day)
        log('Imported ' + catalog.entries.length + ' recipe links')
        return { count: catalog.entries.length }
      })
      nextAt?.(nextAllowed(db, key))
      if (result.held)
        finishAs?.('no-change', 'Catalog refresh is cooling down')
      return result
    },
    {
      manual: true,
      retry: true,
      source: SOURCE,
      modes: ['live'],
      description: 'Import recipe, reagent and vendor purchase links',
    },
  )

  app.get('/api/v1/markets', async (req) =>
    searchMarket(ctx.profile(), req.query),
  )
  app.post('/api/v1/markets/refresh', async () =>
    ctx.jobs.run('market.refresh', { ...ctx.profile() }),
  )
  app.post('/api/v1/markets/recipes/refresh', async () =>
    ctx.jobs.run('market.recipes', { ...ctx.profile() }),
  )
  app.get('/api/v1/markets/:id', async (req) => {
    const profile = ctx.profile(),
      id = positive(req.params.id, 'item id')
    const info = envelope(profile),
      item = getMarketItem(profile, id),
      detail = readDetail(profile, id)
    const uses = profile.db
      .prepare(
        'SELECT data FROM market_recipes WHERE id IN (SELECT recipe FROM market_recipe_uses WHERE item=?) LIMIT 20',
      )
      .all(id)
      .map((r) => JSON.parse(r.data))
    return {
      ...info,
      item,
      detail,
      uses,
      history:
        detail?.history ??
        getMarketSeries(profile, id).map((r) => ({
          t: r.t,
          ask: r.ask,
          listed: r.listed,
          sold: null,
          method: 'bulk observations',
        })),
      quote: marketQuote(
        profile,
        id,
        positive(req.query.quantity ?? 1, 'quantity'),
      ),
      missing: item === null,
    }
  })
  app.post('/api/v1/markets/:id/detail', async (req) =>
    queueDetail(ctx.profile(), positive(req.params.id, 'item id')),
  )
  app.get('/api/v1/opportunities', async (req) => {
    const profile = ctx.profile()
    const { asOf, action, order } = req.query
    const clock =
      asOf === undefined
        ? undefined
        : /^\d+$/.test(asOf)
          ? Number(asOf)
          : Date.parse(asOf)
    if (clock !== undefined && (!Number.isSafeInteger(clock) || clock < 0))
      throw bad('Invalid replay time')
    const info = envelope(profile, clock)
    if (req.query.view === 'house') {
      return { ...info, asOf: clock ?? null, overview: houseOverview(profile.db, info.snapshot, req.query.window, clock) }
    }
    const offset = Number(req.query.offset ?? 0),
      limit = positive(req.query.limit ?? 50, 'page size', 100)
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw bad('Invalid page offset')
    if (!info.snapshot)
      return { ...info, items: [], count: 0, ruleVersion: 'market-rules/1' }
    const sql =
      clock === undefined
        ? 'SELECT data FROM market_findings WHERE house=? AND t=?'
        : `SELECT j.value AS data FROM (
        SELECT data,ROW_NUMBER() OVER(PARTITION BY id ORDER BY known DESC) AS version
        FROM market_signal_versions WHERE house=? AND t=? AND known<=?
      ) r JOIN json_each(r.data) j WHERE r.version=1`
    const args = [
      info.house,
      info.snapshot.t,
      ...(clock === undefined ? [] : [clock]),
    ]
    const where =
      action && action !== 'all' ? " WHERE json_extract(data,'$.action')=?" : ''
    if (where) args.push(String(action).slice(0, 40))
    const sort =
      order === 'name'
        ? "json_extract(data,'$.name')"
        : "json_extract(data,'$.title')"
    const filtered = ' FROM (' + sql + ')' + where
    const count = profile.db
      .prepare('SELECT count(*) AS n' + filtered)
      .get(...args).n
    const rows = profile.db
      .prepare(
        'SELECT data' +
          filtered +
          ' ORDER BY ' +
          sort +
          " COLLATE NOCASE,json_extract(data,'$.id'),json_extract(data,'$.rule') LIMIT ? OFFSET ?",
      )
      .all(...args, limit, offset)
    return {
      ...info,
      items: rows.map((r) => JSON.parse(r.data)),
      count,
      ruleVersion: 'market-rules/1',
      asOf: clock ?? null,
    }
  })
}
