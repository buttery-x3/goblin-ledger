import { DatabaseSync } from 'node:sqlite'
import { tmpdir, cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  ensureStore,
  insertSnapshot,
  transaction,
  saveHouse,
} from '../apps/local/market-store.mjs'
import { registerMarket } from '../apps/local/market.mjs'
import { HOUR } from '../packages/domain/market.mjs'

// Synthetic load measurement. Always uses a new disposable directory.
const size = Number(process.argv[2] ?? 6600),
  slots = Number(process.argv[3] ?? 720)
if (
  !Number.isInteger(size) ||
  size < 1 ||
  size > 7500 ||
  !Number.isInteger(slots) ||
  slots < 1 ||
  slots > 720
)
  throw new Error('Use 1–7500 items and 1–720 hours.')
const dir = mkdtempSync(join(tmpdir(), 'goblin-benchmark-')),
  file = join(dir, 'market.sqlite')
const db = new DatabaseSync(file)
const profile = { mode: 'live', region: 'us', db }
const house = {
  key: 'us-2-110',
  region: 'us',
  ruleset: 2,
  house: 110,
  grp: 1,
  faction: 'alliance',
}
const start = Date.UTC(2026, 0, 1)
try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')
  ensureStore(profile)
  saveHouse(db, house)
  const routes = new Map()
  const app = { get: (path, fn) => routes.set(path, fn), post: () => {} }
  registerMarket(app, { profile: () => profile, jobs: { register: () => {} } })
  const elapsed = performance.now()
  let peak = process.memoryUsage().rss
  for (let slot = 0; slot < slots; slot++) {
    const t = start + slot * HOUR
    const items = Array.from({ length: size }, (_, index) => {
      const id = index + 1,
        ask = 100 + id,
        pinned = id % 101 === 0,
        listed = 500 + ((slot + id) % 25)
      return {
        id,
        t,
        house: house.key,
        source: 'benchmark',
        name: 'Synthetic ' + id,
        category: 'Trade Goods',
        commodity: true,
        ask,
        ask2: ask * 2,
        sell: pinned ? ask : 10,
        buy: null,
        listed,
        listings: 65,
        depth: pinned ? 400 : 30,
        sold: 30,
        traded: 30 * ask,
        hours: 24,
        open: ask,
        added: 60,
        cancelled: 10,
        expired: 20,
        method: 'bulk/v1',
        resolution: 'item-id',
      }
    })
    transaction(db, () =>
      insertSnapshot(db, {
        t,
        house: house.key,
        source: 'benchmark',
        retrieved: t,
        items,
      }),
    )
    peak = Math.max(peak, process.memoryUsage().rss)
    if ((slot + 1) % 24 === 0)
      console.error(
        'hours',
        slot + 1,
        'elapsed seconds',
        Math.round((performance.now() - elapsed) / 1000),
      )
  }
  const ingest = performance.now() - elapsed
  const open = performance.now()
  await routes.get('/api/v1/markets')({ query: { limit: 40 } })
  await routes.get('/api/v1/opportunities')({ query: {} })
  const openMs = performance.now() - open,
    detail = performance.now()
  await routes.get('/api/v1/markets/:id')({
    params: { id: '1' },
    query: { quantity: 1 },
  })
  const detailMs = performance.now() - detail
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  console.log(
    JSON.stringify(
      {
        size,
        slots,
        observations: size * slots,
        cpu: cpus()[0].model,
        ramGiB: totalmem() / 2 ** 30,
        node: process.version,
        ingestSeconds: ingest / 1000,
        openMs,
        detailMs,
        dbBytes: statSync(file).size,
        peakRssBytes: peak,
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
  rmSync(dir, { recursive: true, force: true })
}
