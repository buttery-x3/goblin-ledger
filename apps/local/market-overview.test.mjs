import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { HOUR } from '../../packages/domain/market.mjs'
import { registerMarket } from './market.mjs'
import {
  ensureStore,
  saveHouse,
  insertSnapshot,
  transaction,
} from './market-store.mjs'

const source = 'auctionhouse.tk.gg'
const start = Date.UTC(2026, 10, 18, 6, 17)
const house = {
  key: 'us-2-110',
  region: 'us',
  house: 110,
  grp: 1,
  ruleset: 2,
  faction: 'alliance',
}
function setup(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const profile = { db, mode: 'live', region: 'us' }
  ensureStore(profile)
  saveHouse(db, house)
  const routes = new Map()
  registerMarket(
    { get: (key, fn) => routes.set(key, fn), post() {} },
    {
      profile: () => profile,
      jobs: { register() {} },
      marketFetch() {
        throw Error('Unexpected external call')
      },
    },
  )
  function add(
    time,
    entries,
    { retrieved = time, provider = source, key = house.key } = {},
  ) {
    const items = entries.map(([id, ask, listed, overrides]) => ({
      id,
      ask,
      listed,
      t: time,
      name: 'Item ' + id,
      category: 'Ore',
      sold: null,
      commodity: true,
      source: provider,
      house: key,
      method: 'bulk/v1',
      resolution: 'item-id',
      ...overrides,
    }))
    transaction(db, () =>
      insertSnapshot(db, {
        t: time,
        house: key,
        source: provider,
        retrieved,
        items,
      }),
    )
  }
  const overview = (query = {}) =>
    routes.get('/api/v1/opportunities')({ query: { view: 'house', ...query } })
  return { profile, add, overview, routes }
}

test('first observation gives exact current supply, item coverage and inspectable IDs; no baseline yields no invented changes', async (t) => {
  const { overview, add, routes } = setup(t)
  assert.equal((await overview()).overview, null)
  add(start, [
    [1, 2540, Number.MAX_SAFE_INTEGER],
    [2, null, 1],
    [3, 150, null],
  ])
  const info = await overview()
  assert.equal(info.house, house.key)
  assert.equal(info.snapshot.source, source)
  assert.equal(info.overview.knownListedUnits, '9007199254740992')
  assert.equal(info.overview.itemsWithUnits, 2)
  assert.equal(info.overview.itemsWithAsk, 2)
  assert.equal(info.overview.baseline, null)
  assert.equal(info.overview.asks.compared, 0)
  assert.deepEqual(
    info.overview.leaders.listed.map((r) => r.id),
    [1, 2],
  )
  const item = await routes.get('/api/v1/markets/:id')({
    params: { id: 1 },
    query: {},
  })
  assert.equal(item.item.ask, info.overview.leaders.listed[0].ask)
  add(start + HOUR, [[1, null, null]])
  assert.equal((await overview()).overview.knownListedUnits, null)
  add(start + 2 * HOUR, [])
  assert.equal((await overview()).overview.knownListedUnits, '0')
})

test('whole-house breadth and both directional rankings compare actual matched values; zero, unknown, entrants and departures are distinct', async (t) => {
  const { overview, add, routes } = setup(t)
  add(start, [
    [1, 100, 10],
    [2, 1000, 200],
    [3, 9000, 30],
    [4, 500, null],
    [5, 999, 0],
    [6, 600, 55],
    [7, 500, 25],
    [8, 800, 50],
    [9, 1000, 0],
  ])
  add(start + HOUR, [
    [1, 130, 40],
    [2, 1100, 100],
    [3, 5000, 30],
    [4, null, 40],
    [5, 999, 10],
    [7, 9999, 99, { method: 'new' }],
    [8, 9999, 99, { resolution: 'variant' }],
    [9, 500, 0],
    [10, 100, 12],
  ])
  const { overview: a } = await overview({
    action: 'supply',
    order: 'name',
    offset: 100,
  })
  assert.equal(a.baseline.t, start)
  assert.equal(a.newItems, 1)
  assert.equal(a.absentItems, 1)
  assert.deepEqual(a.asks, { up: 2, down: 2, flat: 1, compared: 5 })
  assert.deepEqual(a.supply, { up: 2, down: 1, flat: 2, compared: 5 })
  assert.deepEqual(
    a.leaders.rising.map((x) => [x.id, x.before, x.after]),
    [
      [1, 100, 130],
      [2, 1000, 1100],
    ],
  )
  assert.deepEqual(
    a.leaders.falling.map((x) => x.id),
    [9, 3],
  )
  assert.deepEqual(
    a.leaders.added.map((x) => x.delta),
    [30, 10],
  )
  assert.deepEqual(
    a.leaders.reduced.map((x) => x.delta),
    [-100],
  )
  const signals = await routes.get('/api/v1/opportunities')({
    query: { action: 'supply' },
  })
  assert(signals.items.some((r) => r.id === 2 && r.rule === 'supply-drop'))
})

test('named lookbacks select nearby comparable house scans, honor replay availability and a missing day without substituting earlier data', async (t) => {
  const { overview, add } = setup(t)
  const now = start + 25 * HOUR
  add(start, [[1, 200, 10]])
  add(start + HOUR, [[1, 220, 12]], { retrieved: now + 2 * HOUR })
  add(start + HOUR + 100, [[1, 1, 1]], { key: 'eu-2-110' })
  add(start + HOUR + 150, [[1, 1, 1]], { provider: 'different source' })
  add(now, [[1, 300, 8]])
  assert.equal(
    (await overview({ window: '24h' })).overview.baseline.t,
    start + HOUR,
  )
  assert.equal(
    (await overview({ window: '24h', asOf: String(now) })).overview.baseline.t,
    start,
  )
  assert.equal((await overview({ window: '7d' })).overview.baseline, null)
  assert.equal((await overview({ asOf: String(start - 1) })).overview, null)
  await assert.rejects(
    overview({ window: 'fortnight' }),
    /Unknown market comparison/,
  )
  add(now + 3 * 24 * HOUR, [[1, 330, 30]])
  assert.equal((await overview({ window: '24h' })).overview.baseline, null)
})

test('a large scan ranks all items, returns bounded leaders, and breaks ties by item ID', async (t) => {
  const { add, overview } = setup(t)
  const items = Array.from({ length: 6000 }, (_, i) => [i + 1, 100, i])
  add(start, items)
  add(
    start + HOUR,
    items.map(([id, ask, listed]) => [
      id,
      id === 6000 ? 1100 : ask + 1,
      listed + 1,
    ]),
  )
  const { overview: a } = await overview()
  assert.equal(a.asks.up, 6000)
  assert.equal(a.supply.up, 6000)
  assert.deepEqual(
    a.leaders.rising.map((r) => r.id),
    [6000, 1, 2, 3, 4, 5, 6, 7],
  )
  assert.equal(a.leaders.added.length, 8)
  assert.equal(a.leaders.listed[0].id, 6000)
})
