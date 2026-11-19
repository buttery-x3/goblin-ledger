import { createHash } from 'node:crypto'
import { HOUR, SOURCE, scanItem, tierUnits } from '../../packages/domain/market.mjs'
import { demoData } from './market-demo.mjs'

const initialized = new WeakSet()
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const value = fn()
    db.exec('COMMIT')
    return value
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export function ensureStore({ db, mode, region }) {
  if (!initialized.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS market_snapshots(house TEXT, t INTEGER, source TEXT NOT NULL, retrieved INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(house,t));
      CREATE TABLE IF NOT EXISTS market_rows(house TEXT,t INTEGER,id INTEGER,name TEXT,category TEXT,ask INTEGER,listed INTEGER,sold INTEGER,data TEXT NOT NULL,PRIMARY KEY(house,t,id));
      CREATE INDEX IF NOT EXISTS market_item_time ON market_rows(house,id,t);
      CREATE TABLE IF NOT EXISTS market_details(house TEXT,id INTEGER,t INTEGER,retrieved INTEGER,data TEXT NOT NULL,PRIMARY KEY(house,id,t));
      CREATE TABLE IF NOT EXISTS market_findings(house TEXT,t INTEGER,id INTEGER,rule TEXT,data TEXT NOT NULL,PRIMARY KEY(house,t,id,rule));
      CREATE TABLE IF NOT EXISTS market_signal_versions(house TEXT,t INTEGER,id INTEGER,known INTEGER,data TEXT NOT NULL,PRIMARY KEY(house,t,id,known));
      CREATE TABLE IF NOT EXISTS market_house(region TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_cooldown(key TEXT PRIMARY KEY,next INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS market_recipes(id INTEGER PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_recipe_uses(item INTEGER,recipe INTEGER,name TEXT,profession TEXT,PRIMARY KEY(item,recipe));
      CREATE TABLE IF NOT EXISTS market_vendor(id INTEGER PRIMARY KEY,price INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS market_recipe_items(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_catalog_meta(source TEXT PRIMARY KEY,revision TEXT NOT NULL,retrieved INTEGER NOT NULL,etag TEXT,modified TEXT);
    `)
    initialized.add(db)
  }
  if (mode === 'demo') ensureDemoFixtures(db, region || 'us')
}

function ensureDemoFixtures(db, region) {
  const revision = 2
  const saved = db.prepare('SELECT data FROM market_house WHERE region=?').get(region)
  if (saved && JSON.parse(saved.data).demoRevision >= revision) return
  const demo = demoData(region)
  const house = demo.house.key
  transaction(db, () => {
    const lookup = db.prepare('SELECT source FROM market_snapshots WHERE house=? AND t=?')
    for (const snapshot of demo.snapshots) {
      const existing = lookup.get(house, snapshot.t)
      if (existing && existing.source !== 'demo') continue
      if (existing) {
        for (const table of ['market_snapshots', 'market_rows', 'market_details', 'market_findings', 'market_signal_versions'])
          db.prepare('DELETE FROM ' + table + ' WHERE house=? AND t=?').run(house, snapshot.t)
      }
      writeSnapshot(db, snapshot)
    }
    const end = demo.snapshots.at(-1).t
    if (lookup.get(house, end)?.source === 'demo') {
      for (const detail of demo.details) insertDetail(db, detail, end)
    }
    saveHouse(db, { ...demo.house, demoRevision: revision })
  })
}
export function saveHouse(db, house) {
  db.prepare('INSERT OR REPLACE INTO market_house VALUES(?,?)').run(
    house.region,
    JSON.stringify(house),
  )
}
export function getHouse(profile) {
  ensureStore(profile)
  const row = profile.db
    .prepare('SELECT data FROM market_house WHERE region=?')
    .get(profile.region ?? (profile.mode === 'demo' ? 'us' : ''))
  return row ? JSON.parse(row.data) : null
}
export function latest(db, house) {
  return (
    db
      .prepare(
        'SELECT * FROM market_snapshots WHERE house=? ORDER BY t DESC LIMIT 1',
      )
      .get(house) ?? null
  )
}
function updateFindings(db, house, t, known, id = null) {
  const args = [house, (Math.floor(t / HOUR) - 7) * HOUR, t]
  // Compare one complete immutable overview with previous slots. A later book can enrich that same slot.
  const rows = db
    .prepare(
      'SELECT data FROM market_rows WHERE house=? AND t>=? AND t<=?' +
        (id === null ? '' : ' AND id=?') +
        ' ORDER BY t',
    )
    .iterate(...args, ...(id === null ? [] : [id]))
  const grouped = new Map()
  for (const record of rows) {
    const row = JSON.parse(record.data)
    if (!grouped.has(row.id)) grouped.set(row.id, [])
    grouped.get(row.id).push(row)
  }
  db.prepare(
    'DELETE FROM market_findings WHERE house=? AND t=?' +
      (id === null ? '' : ' AND id=?'),
  ).run(house, t, ...(id === null ? [] : [id]))
  const put = db.prepare('INSERT INTO market_findings VALUES(?,?,?,?,?)')
  const archive = db.prepare(
    'INSERT OR REPLACE INTO market_signal_versions VALUES(?,?,?,?,?)',
  )
  for (const [item, series] of grouped) {
    const findings = scanItem(series, t)
    for (const find of findings)
      put.run(house, t, item, find.rule, JSON.stringify(find))
    // Empty revisions withdraw older signals when a targeted check changes the evidence.
    if (findings.length || id !== null)
      archive.run(house, t, item, known, JSON.stringify(findings))
  }
}
function writeSnapshot(db, snapshot) {
  const { t, house, source, retrieved, items } = snapshot
  db.prepare('INSERT INTO market_snapshots VALUES(?,?,?,?,?)').run(
    house,
    t,
    source,
    retrieved,
    items.length,
  )
  const save = db.prepare('INSERT INTO market_rows VALUES(?,?,?,?,?,?,?,?,?)')
  for (const row of items) {
    const data = { ...row, floor: tierUnits(row, null) }
    save.run(
      house,
      t,
      row.id,
      row.name,
      row.category,
      row.ask,
      row.listed,
      row.sold,
      JSON.stringify(data),
    )
  }
  updateFindings(db, house, t, retrieved)
}
export function insertSnapshot(db, snapshot) {
  const { house, t } = snapshot
  if (latest(db, house)?.t >= t) return false
  writeSnapshot(db, snapshot)
  // Bound local storage to the provider's 30-day hourly history window.
  const before = t - 30 * 24 * HOUR
  for (const table of [
    'market_snapshots',
    'market_rows',
    'market_findings',
    'market_details',
    'market_signal_versions',
  ])
    db.prepare('DELETE FROM ' + table + ' WHERE house=? AND t<?').run(
      house,
      before,
    )
  return true
}
export function insertDetail(db, detail, retrieved = Date.now()) {
  const { house, id, book } = detail
  const t = book.t ?? detail.history.at(-1)?.t
  if (t == null) return
  db.prepare('INSERT OR REPLACE INTO market_details VALUES(?,?,?,?,?)').run(
    house,
    id,
    t,
    retrieved,
    JSON.stringify(detail),
  )
  const found = db
    .prepare('SELECT data FROM market_rows WHERE house=? AND t=? AND id=?')
    .get(house, t, id)
  if (found && book.t === t) {
    const row = JSON.parse(found.data)
    if (
      book.levels.length &&
      (book.levels[0].price !== row.ask ||
        (row.listed != null &&
          book.levels.reduce((sum, l) => sum + l.units, 0) > row.listed))
    )
      throw new Error('Provider contract: book disagrees with its overview')
    row.floor = tierUnits(row, book)
    db.prepare(
      'UPDATE market_rows SET data=? WHERE house=? AND t=? AND id=?',
    ).run(JSON.stringify(row), house, t, id)
    updateFindings(db, house, t, retrieved, id)
  }
}
export function readDetail(profile, id) {
  const house = getHouse(profile)
  const row =
    house &&
    profile.db
      .prepare(
        'SELECT data,retrieved FROM market_details WHERE house=? AND id=? ORDER BY t DESC LIMIT 1',
      )
      .get(house.key, id)
  return row ? { ...JSON.parse(row.data), retrieved: row.retrieved } : null
}
export function saveCatalog(db, { entries, vendor, items = [] }, retrieved = Date.now(), headers) {
  const revision = createHash('sha256').update(JSON.stringify([entries, vendor, items])).digest('hex')
  transaction(db, () => {
    db.exec(
      'DELETE FROM market_recipes; DELETE FROM market_recipe_uses; DELETE FROM market_vendor; DELETE FROM market_recipe_items',
    )
    const recipes = db.prepare('INSERT INTO market_recipes VALUES(?,?)')
    const uses = db.prepare(
      'INSERT OR IGNORE INTO market_recipe_uses VALUES(?,?,?,?)',
    )
    for (const r of entries) {
      recipes.run(r.id, JSON.stringify(r))
      for (const id of [r.output, ...r.inputs.map((i) => i.id)])
        if (id !== null) uses.run(id, r.id, r.name, r.profession)
    }
    const price = db.prepare('INSERT INTO market_vendor VALUES(?,?)')
    for (const item of vendor) price.run(item.id, item.price)
    const name = db.prepare('INSERT INTO market_recipe_items VALUES(?,?)')
    for (const item of items) name.run(item.id, item.name)
    db.prepare('INSERT OR REPLACE INTO market_catalog_meta VALUES(?,?,?,?,?)').run(
      SOURCE, revision, retrieved, headers?.get('etag')?.slice(0,512) ?? null,
      headers?.get('last-modified')?.slice(0,128) ?? null,
    )
  })
}
