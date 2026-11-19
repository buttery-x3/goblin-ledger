import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { ensureStore, readDetail } from './market-store.mjs'

test('a returning demo gains the current example trends without touching other observations or accounts', t => {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const profile = { db, mode: 'demo', region: 'us' }
  ensureStore(profile)
  const house = 'us-2-110'
  const series = () => db.prepare('SELECT t,ask,listed,data FROM market_rows WHERE house=? AND id=2589 ORDER BY t').all(house)
  const fresh = series()
  const book = readDetail(profile, 2589)
  assert.ok(fresh[0].ask < fresh.at(-1).ask)
  db.prepare("UPDATE market_house SET data=json_remove(data,'$.demoRevision') WHERE region='us'").run()
  db.prepare("UPDATE market_rows SET ask=200, data=json_set(data,'$.ask',200) WHERE id=2589").run()
  db.prepare('DELETE FROM market_details WHERE house=? AND id=2589').run(house)
  db.prepare("INSERT INTO market_snapshots VALUES(?,?, 'demo', ?,0)").run(house, book.book.t+1000, book.book.t+1000)
  db.exec("CREATE TABLE personal_notes(pool,asset,record); INSERT INTO personal_notes VALUES('fixture','42/0/tradeable','example note')")
  ensureStore(profile)
  assert.deepEqual(series(),fresh)
  assert.deepEqual(readDetail(profile,2589),book)
  assert.equal(db.prepare('SELECT count(*) AS n FROM market_snapshots WHERE house=?').get(house).n,9)
  assert.equal(db.prepare('SELECT record FROM personal_notes').get().record,'example note')
  const writes = db.prepare('SELECT total_changes() AS n').get().n
  ensureStore(profile)
  assert.equal(db.prepare('SELECT total_changes() AS n').get().n,writes)
})
