import { HOUR } from '../../packages/domain/market.mjs'

const windows = new Map([
  ['previous', null],
  ['24h', 24 * HOUR],
  ['7d', 7 * 24 * HOUR],
])
const displayLimit = 8

function baselineFor(db, current, window, asOf) {
  const age = windows.get(window)
  const cutoff = asOf ?? Number.MAX_SAFE_INTEGER
  if (age === null) {
    return db
      .prepare(
        'SELECT * FROM market_snapshots WHERE house=? AND source=? AND t<? AND retrieved<=? ORDER BY t DESC LIMIT 1',
      )
      .get(current.house, current.source, current.t, cutoff)
  }
  const target = current.t - age
  // Allow the normal hourly scan to drift, without silently substituting a remote date.
  return db
    .prepare(
      'SELECT * FROM market_snapshots WHERE house=? AND source=? AND t BETWEEN ? AND ? AND retrieved<=? ORDER BY ABS(t-?), t DESC LIMIT 1',
    )
    .get(
      current.house,
      current.source,
      target - HOUR,
      target + HOUR,
      cutoff,
      target,
    )
}

function breadth() {
  return { up: 0, down: 0, flat: 0, compared: 0 }
}

// Order percentage changes by the exact ratio. Ties retain the lower item ID.
// For unit deltas and absolute quantities the denominator is always one.
function rank(list, item, numerator, denominator = 1) {
  const n = BigInt(numerator),
    d = BigInt(denominator)
  const index = list.findIndex((r) => {
    const a = n * r.d,
      b = r.n * d
    return a > b || (a === b && item.id < r.item.id)
  })
  if (index < 0 && list.length >= displayLimit) return
  list.splice(index < 0 ? list.length : index, 0, { item, n, d })
  if (list.length > displayLimit) list.pop()
}

function compareMetric(counts, lists, id, name, before, after, percent) {
  if (
    before == null ||
    after == null ||
    (percent && (before <= 0 || after <= 0))
  )
    return
  const delta = after - before
  const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  counts.compared++
  counts[direction]++
  if (delta !== 0)
    rank(
      lists[direction],
      { id, name, before, after, delta },
      Math.abs(delta),
      percent ? before : 1,
    )
}

export function houseOverview(db, current, window = 'previous', asOf) {
  if (!windows.has(window))
    throw Object.assign(Error('Unknown market comparison window.'), {
      statusCode: 400,
    })
  if (!current) return null
  const baseline = baselineFor(db, current, window, asOf) ?? null
  const result = {
    window,
    baseline,
    knownListedUnits: null,
    itemsWithUnits: 0,
    itemsWithAsk: 0,
    sharedIds: 0,
    newItems: null,
    absentItems: null,
    asks: breadth(),
    supply: breadth(),
  }
  const price = { up: [], down: [] },
    units = { up: [], down: [] },
    mostListed = []
  let totalUnits = 0n
  // Two composite-index lookups per item at most. Never traverse the hourly archive
  // on a dashboard read. The snapshot IDs and provenance remain fixed throughout.
  const rows = db
    .prepare(
      `
    SELECT c.id,c.name,c.ask,c.listed,p.id AS priorId,p.ask AS priorAsk,p.listed AS priorListed,
      CASE WHEN p.id IS NOT NULL THEN
        json_extract(c.data,'$.source')=? AND json_extract(p.data,'$.source')=? AND
        json_extract(c.data,'$.method')=json_extract(p.data,'$.method') AND
        json_extract(c.data,'$.resolution')='item-id' AND json_extract(p.data,'$.resolution')='item-id' AND
        json_extract(c.data,'$.commodity')=json_extract(p.data,'$.commodity')
      END AS comparable
    FROM market_rows c LEFT JOIN market_rows p ON p.house=c.house AND p.t=? AND p.id=c.id
    WHERE c.house=? AND c.t=?`,
    )
    .iterate(
      current.source,
      current.source,
      baseline?.t ?? null,
      current.house,
      current.t,
    )
  for (const row of rows) {
    if (row.ask > 0) result.itemsWithAsk++
    if (row.listed != null) {
      totalUnits += BigInt(row.listed)
      result.itemsWithUnits++
      if (row.listed > 0)
        rank(
          mostListed,
          { id: row.id, name: row.name, after: row.listed, ask: row.ask },
          row.listed,
        )
    }
    if (row.priorId != null) result.sharedIds++
    if (!row.comparable) continue
    compareMetric(
      result.asks,
      price,
      row.id,
      row.name,
      row.priorAsk,
      row.ask,
      true,
    )
    compareMetric(
      result.supply,
      units,
      row.id,
      row.name,
      row.priorListed,
      row.listed,
      false,
    )
  }
  if (current.count === 0 || result.itemsWithUnits > 0)
    result.knownListedUnits = String(totalUnits)
  if (baseline) {
    result.newItems = current.count - result.sharedIds
    result.absentItems = baseline.count - result.sharedIds
  }
  const items = (list) => list.map((r) => r.item)
  return {
    ...result,
    leaders: {
      rising: items(price.up),
      falling: items(price.down),
      added: items(units.up),
      reduced: items(units.down),
      listed: items(mostListed),
    },
  }
}
