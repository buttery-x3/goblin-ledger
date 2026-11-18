import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HOUR,
  discoverHouse,
  normalizeOverview,
  normalizeDetail,
  normalizeRecipes,
  quoteLadder,
  scanItem,
  tierUnits,
} from '../../packages/domain/market.mjs'
import {
  registerMarket,
  getMarketBook,
  getMarketItem,
  marketQuote,
  getMarketSeries,
  getMarketNextAttempt,
} from './market.mjs'
import {
  ensureStore,
  saveHouse,
  insertSnapshot,
  insertDetail,
  transaction,
} from './market-store.mjs'

const house = {
  key: 'us-2-110',
  region: 'us',
  ruleset: 2,
  house: 110,
  grp: 1,
  faction: 'alliance',
  snapshot: 10 * HOUR,
}
const f = [
  'value24',
  'ask2',
  'vol24',
  'flowHours',
  'listings',
  'depth5',
  'listed',
  'ask',
]
const bulk = {
  house,
  t: 10 * HOUR,
  f,
  items: [
    {
      id: 731,
      name: 'Unwatched ore',
      sell: 100,
      cls: 'Ore',
      o: [null, 105, null, 0, 10, 800, 850, 100],
    },
  ],
}
const details = {
  house,
  item: { id: 731 },
  book: [
    [100, 800, 1],
    [105, 10, 1],
    [200, 40, 8],
  ],
  bookMore: 0,
  bookT: bulk.t,
  method: { v: 2, since: 9 * HOUR },
  f: ['ask', 'listed', 'sold'],
  series: {
    t: [8 * HOUR, 9 * HOUR, 10 * HOUR],
    ask: [100, 100, 100],
    listed: [800, 200, 850],
    sold: [null, 0, 1],
  },
}
function harness(t, mode, fetcher, dir) {
  const db = new DatabaseSync(dir ? join(dir, 'market.db') : ':memory:')
  t.after(() => db.close())
  const profile = { db, mode, region: 'us' },
    handlers = new Map(),
    routes = new Map()
  const jobs = {
    register: (name, fn) => handlers.set(name, fn),
    run: (name, profile, payload) =>
      handlers.get(name)({ profile, payload, log() {} }),
  }
  const app = {
    get: (path, fn) => routes.set('GET ' + path, fn),
    post: (path, fn) => routes.set('POST ' + path, fn),
  }
  registerMarket(app, { profile: () => profile, jobs, marketFetch: fetcher })
  return {
    profile,
    jobs,
    request: (method, path, params = {}, query = {}) =>
      routes.get(method + ' /api/v1' + path)({ params, query }),
  }
}

test('vendor scanner discovers unfamiliar IDs; noise and missing slots cannot create a wall/refill', () => {
  const one = normalizeOverview(bulk, house).items[0]
  const series = Array.from({ length: 8 }, (_, i) => ({
    ...one,
    id: 900000,
    t: (i + 1) * HOUR,
    floor: [700, 710, 680, 720, 640, 800, 200, 750][i],
  }))
  const signals = scanItem([series[3], ...series].reverse(), 8 * HOUR)
  assert.deepEqual(
    signals.map((r) => r.rule),
    ['vendor-pin', 'floor-wall', 'floor-refill'],
  )
  assert.equal(signals[0].observed, 8)
  assert.deepEqual([signals[2].down, signals[2].up], [-600, 550])
  assert(
    !scanItem(
      series.filter((_, i) => i !== 6),
      8 * HOUR,
    ).some((r) => r.rule === 'floor-refill'),
  )
  assert(
    !scanItem(
      series.map((r) => ({ ...r, floor: 1 })),
      8 * HOUR,
    ).some((r) => r.rule === 'floor-wall'),
  )
  assert.deepEqual(
    scanItem(
      series.map((r) => ({ ...r, ask: 800 })),
      8 * HOUR,
    ),
    [],
  )
  assert.equal(
    scanItem(
      series.map((r, i) => (i === 7 ? { ...r, house: 'eu-2-110' } : r)),
      8 * HOUR,
    ).some((r) => r.rule === 'vendor-pin'),
    false,
  )
})
test('named columns, capped ladder, same-house/time gates and method boundaries', () => {
  const item = normalizeOverview(bulk, house).items[0]
  assert.equal(item.sold, null)
  assert.equal(item.hours, 0)
  assert.equal(item.ask, 100)
  assert.equal(tierUnits(item, null), null)
  assert.equal(tierUnits({ ...item, ask2: 106 }, null), 800)
  const d = normalizeDetail(details, house, 731)
  assert.deepEqual(
    d.history.map((r) => r.method),
    ['prior', 'v2', 'v2'],
  )
  const book = {
    ...d.book,
    more: 10,
    levels: [{ price: 100, units: 80, auctions: 1 }],
  }
  assert.equal(quoteLadder(book, 12).status, 'complete')
  assert.deepEqual(
    [quoteLadder(book, 100).totalCopper, quoteLadder(book, 100).shortfall],
    ['8000', 20],
  )
  assert.equal(tierUnits(item, { ...book, house: 'eu-2-110' }), null)
  assert.equal(tierUnits(item, { ...book, t: book.t - 1 }), null)
  assert.equal(
    quoteLadder({ ...book, levels: [{ price: 9007199254740991, units: 2 }] }, 2)
      .totalCopper,
    '18014398509481982',
  )
  assert.throws(
    () =>
      normalizeDetail(
        { ...details, series: { ...details.series, listed: [1] } },
        house,
        731,
      ),
    /unaligned/,
  )
  assert.throws(
    () => normalizeOverview({ ...bulk, f: ['ask'] }, house),
    /field/,
  )
  assert.throws(() => discoverHouse({ houses: [house, house] }, 'us'), /one/)
  assert.equal(normalizeOverview({ ...bulk, t: null, items: [] }, house), null)
})
test('source-acquisition entry points retain last good data and bound requests', async (t) => {
  const calls = []
  const h = harness(t, 'live', async (url) => {
    calls.push(url)
    if (url.endsWith('/api/markets')) return Response.json({ houses: [house] })
    if (url.includes('/item/')) return Response.json(details)
    return Response.json(bulk)
  })
  assert.equal((await h.request('GET', '/markets')).status, 'awaiting-snapshot')
  await h.request('POST', '/markets/refresh')
  await h.request('POST', '/markets/:id/detail', { id: '731' })
  await h.request('POST', '/markets/refresh')
  assert.equal(calls.filter((u) => u.endsWith('/api/m/us-2-110')).length, 1)
  assert.equal(calls.filter((u) => u.includes('/item/')).length, 1)
  const data = await h.request('GET', '/markets', {}, { q: 'oRe' })
  assert.equal(data.count, 1)
  assert.equal(data.items[0].sold, null)
  assert.equal(data.snapshot.source, 'auctionhouse.tk.gg')
  const result = await h.request(
    'GET',
    '/markets/:id',
    { id: '731' },
    { quantity: 810 },
  )
  assert.equal(result.quote.totalCopper, '81050')
  assert.equal(result.detail.book.t, data.snapshot.t)
  assert.equal(
    (await h.request('GET', '/opportunities')).items[0].rule,
    'floor-wall',
  )
  h.profile.region = 'eu'
  assert.equal(getMarketBook(h.profile, 731), null)
  await assert.rejects(
    () => h.request('POST', '/markets/refresh'),
    /expected one/,
  )
  assert.equal((await h.request('GET', '/markets')).snapshot, null)
  h.profile.region = 'us'
  assert.equal(getMarketItem(h.profile, 731).ask, 100)
})
test('historical decision-time replay excludes later discovery and book enrichment', async (t) => {
  const h = harness(t, 'live')
  const db = h.profile.db
  ensureStore(h.profile)
  saveHouse(db, house)
  const received = bulk.t + 5_000,
    bookReceived = received + 50_000
  transaction(db, () =>
    insertSnapshot(db, normalizeOverview(bulk, house, received)),
  )
  transaction(db, () =>
    insertDetail(db, normalizeDetail(details, house, 731), bookReceived),
  )
  const replay = (asOf) =>
    h.request('GET', '/opportunities', {}, { asOf: String(asOf) })
  assert.equal((await replay(received - 1)).snapshot, null)
  assert.equal((await replay(received)).items.length, 0)
  assert.equal((await replay(bookReceived)).items[0].rule, 'floor-wall')
  assert.equal(getMarketSeries(h.profile, 731)[0].retrievedAt, received)
  await assert.rejects(replay('nonsense'), /Invalid replay time/)
})

test('limited sources respect Retry-After across repeated requests and restarts', async (t) => {
  let calls = 0
  const h = harness(t, 'live', async () => {
    calls++
    return new Response('Busy', {
      status: 429,
      headers: { 'Retry-After': '7200' },
    })
  })
  const start = Date.now()
  await assert.rejects(() => h.request('POST', '/markets/refresh'), /HTTP 429/)
  const again = await h.request('POST', '/markets/refresh')
  assert.equal(again.held, true)
  assert.equal(getMarketNextAttempt(h.profile, 'market.refresh'), again.next)
  assert.equal(
    getMarketNextAttempt({ ...h.profile, region: 'eu' }, 'market.refresh'),
    null,
  )
  assert.equal(getMarketNextAttempt(h.profile, 'market.recipes'), null)
  assert(again.next >= start + 2 * HOUR)
  assert.equal(calls, 1)
  assert.equal((await h.request('GET', '/markets')).snapshot, null)
})

test('independent scan returns volatile attributed fields even without a primary snapshot', async (t) => {
  const h = harness(t, 'live', async (url) => {
    assert.match(
      url,
      /api\.ahledger\.com\/v1\/prices\/forever\.pvp\.alliance\.us\/731\?range=24h$/,
    )
    return Response.json(
      {
        market: 'forever.pvp.alliance.us',
        item: { id: 731, name: 'Unwatched ore' },
        latest: {
          observedAt: '2026-11-18T01:00:00Z',
          source: 'Addon scan',
          minBuyout: 9797,
          quantity: 120,
          auctions: 14,
        },
      },
      { headers: { 'cache-control': 'public, max-age=20', age: '5' } },
    )
  })
  const begin = Date.now()
  const row = await h.request('POST', '/markets/:id/crosscheck', { id: 731 })
  assert.equal(row.ask, 9797)
  assert.equal(row.source, 'AHledger')
  assert(row.expires >= begin + 15000 && row.expires <= Date.now() + 15000)
  assert.equal((await h.request('GET', '/markets')).snapshot, null)
  assert.equal(
    h.profile.db.prepare('SELECT count(*) n FROM market_rows').get().n,
    0,
  )
})

test('an absent or non-retainable independent cache policy expires immediately', async (t) => {
  for (const headers of [
    {},
    { 'cache-control': 'no-store,max-age=60' },
    { 'cache-control': 'public,max-age=60', age: 'unavailable' },
  ]) {
    const h = harness(t, 'live', () =>
      Response.json(
        { market: 'forever.pvp.alliance.us', item: { id: 731 }, latest: null },
        { headers },
      ),
    )
    const r = await h.request('POST', '/markets/:id/crosscheck', { id: 731 })
    assert(r.expires <= Date.now())
    assert.equal(r.observedAt, null)
  }
})

test('standalone file-backed writer publishes before the new snapshot becomes visible', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'goblin-market-'))
  const h = harness(
    t,
    'live',
    async (url) =>
      Response.json(
        url.endsWith('/api/markets')
          ? { houses: [house] }
          : { ...bulk, items: [] },
      ),
    dir,
  )
  t.after(() => rmSync(dir, { force: true, recursive: true }))
  await h.request('POST', '/markets/refresh')
  const data = await h.request('GET', '/markets')
  assert.equal(data.snapshot.count, 0)
  assert.equal(data.status, 'observed')
})
test('demo market, searchable query, history, profile isolation and recipe contract', async (t) => {
  const h = harness(t, 'demo', () => {
    throw new Error('Network forbidden for demo')
  })
  const d = await h.request('GET', '/markets', {}, { q: '3819' })
  assert.equal(d.count, 1)
  assert.equal(d.snapshot.source, 'demo')
  assert.equal(marketQuote(h.profile, 3819, 20).totalCopper, '34400')
  assert.equal(getMarketSeries(h.profile, 8845, { before: 0 }).length, 0)
  assert.equal(
    (await h.request('GET', '/opportunities')).items.some(
      (r) => r.rule === 'floor-refill',
    ),
    true,
  )
  const raw = {
    recipes: [
      { id: 1, name: 'Mixture', prof: 'Alchemy', item: 2, qty: 1, r: [[3, 4]] },
      { id: 2, name: 'Enchant', prof: 'Enchanting', item: null, qty: 1, r: [] },
    ],
    items: { 2: { id: 2 }, 3: { id: 3 } },
    vendor: { 3: 100 },
  }
  const catalog = normalizeRecipes(raw)
  assert.equal(catalog.entries[1].output, null)
  assert.equal(catalog.vendor[0].price, 100)
  for (const qty of [null, undefined, 0, 1.5]) {
    const uncertain = normalizeRecipes({
      ...raw,
      recipes: [{ ...raw.recipes[0], qty }],
    }).entries[0]
    assert.equal(uncertain.quantity, null)
    assert.equal(uncertain.yieldStatus, 'unresolved')
    assert.equal(uncertain.reportedQuantity, qty ?? null)
    assert.equal(uncertain.output, 2)
    assert.equal(uncertain.inputs[0].qty, 4)
  }
  await assert.rejects(() => h.request('POST', '/markets/refresh'), /Demo/)
})
