export const HOUR = 3_600_000
export const SOURCE = 'auctionhouse.tk.gg'
export const RULE_VERSION = 'market-rules/1'

function valid(test, message) {
  if (!test) throw new Error('Provider contract: ' + message)
}

function integer(value, field, min = 0) {
  valid(
    Number.isSafeInteger(value) && value >= min,
    field + ' must be an integer ≥ ' + min,
  )
  return value
}

function optional(value, field) {
  return value == null ? null : integer(value, field)
}

export function discoverHouse(data, region) {
  valid(Array.isArray(data?.houses), 'houses array missing')
  const matches = data.houses.filter(
    (h) => h?.region === region && h.grp === 1 && h.faction === 'alliance',
  )
  valid(matches.length === 1, 'expected one ' + region + ' PvP Alliance house')
  const house = matches[0]
  valid(
    house.key ===
      [
        region,
        integer(house.ruleset, 'ruleset', 1),
        integer(house.house, 'house', 1),
      ].join('-'),
    'house key mismatch',
  )
  return house
}

function matchHouse(actual, expected) {
  valid(
    actual?.key === expected.key &&
      actual.house === expected.house &&
      actual.region === expected.region &&
      actual.grp === 1 &&
      actual.faction === 'alliance',
    'response belongs to a different house',
  )
}

function fields(list, required) {
  valid(
    Array.isArray(list) &&
      list.every((f) => typeof f === 'string') &&
      new Set(list).size === list.length &&
      required.every((f) => list.includes(f)),
    'missing or duplicate field names',
  )
  return Object.fromEntries(list.map((name, i) => [name, i]))
}

export function normalizeOverview(raw, house, retrieved = Date.now()) {
  matchHouse(raw?.house, house)
  valid(
    Array.isArray(raw.items) && raw.items.length <= 150_000,
    'invalid items',
  )
  if (raw.t === null && raw.items.length === 0) return null
  const t = integer(raw.t, 'snapshot time', 1)
  const index = fields(raw.f, [
    'ask',
    'ask2',
    'listed',
    'depth5',
    'listings',
    'vol24',
    'value24',
    'flowHours',
  ])
  const seen = new Set()
  const items = raw.items.map((it) => {
    const id = integer(it.id, 'item id', 1)
    valid(!seen.has(id), 'duplicate item ' + id)
    seen.add(id)
    valid(
      Array.isArray(it.o) && it.o.length === raw.f.length,
      'unaligned overview row',
    )
    const n = (key) => optional(it.o[index[key]], key)
    const ask = n('ask'),
      ask2 = n('ask2'),
      listed = n('listed'),
      depth = n('depth5')
    valid(
      (ask == null || ask > 0) && (ask2 == null || (ask != null && ask2 > ask)),
      'ask price tiers unordered',
    )
    valid(
      depth == null || listed == null || depth <= listed,
      'near-floor units exceed total',
    )
    valid(it.nc == null || it.nc === 1, 'invalid commodity flag')
    return {
      id,
      name: typeof it.name === 'string' ? it.name : null,
      category: [it.cls, it.sub].filter(Boolean).join(' / '),
      ask,
      ask2,
      listed,
      depth,
      listings: n('listings'),
      sold: n('vol24'),
      traded: n('value24'),
      hours: n('flowHours'),
      sell: optional(it.sell, 'sell'),
      buy: optional(it.buy, 'buy'),
      open: n('open24'),
      added: n('added24'),
      cancelled: n('cancelled24'),
      expired: n('expired24'),
      commodity: it.nc !== 1,
      t,
      house: house.key,
      source: SOURCE,
      method: 'bulk/v1',
      resolution: 'item-id',
    }
  })
  return { t, house: house.key, source: SOURCE, retrieved, items }
}

export function normalizeDetail(raw, house, id) {
  matchHouse(raw?.house, house)
  valid(raw.item?.id === id, 'item mismatch')
  fields(raw.f, ['ask', 'listed', 'sold'])
  const times = raw.series?.t
  valid(
    Array.isArray(times) &&
      times.length <= 720 &&
      raw.f.every(
        (k) =>
          Array.isArray(raw.series[k]) && raw.series[k].length === times.length,
      ),
    'unaligned hourly series',
  )
  const method = raw.method ?? null
  if (method) {
    integer(method.v, 'method version', 1)
    integer(method.since, 'method boundary', 1)
  }
  const history = times.map((t, i) => {
    integer(t, 'hourly timestamp', 1)
    valid(
      i === 0 || times[i - 1] < t,
      'unordered or duplicate series timestamps',
    )
    return {
      t,
      ask: optional(raw.series.ask[i], 'ask'),
      listed: optional(raw.series.listed[i], 'listed'),
      sold: optional(raw.series.sold[i], 'sold'),
      method:
        method && t >= method.since
          ? 'v' + method.v
          : method
            ? 'prior'
            : 'unknown',
    }
  })
  valid(Array.isArray(raw.book) && raw.book.length <= 60, 'invalid book')
  const levels = raw.book.map(([price, units, auctions], i) => {
    integer(price, 'book price', 1)
    integer(units, 'book units', 1)
    integer(auctions, 'book auctions', 1)
    valid(
      i === 0 || price > raw.book[i - 1][0],
      'unordered or repeated price tier',
    )
    return { price, units, auctions }
  })
  const more = integer(raw.bookMore, 'extra book tiers'),
    t = optional(raw.bookT, 'book timestamp')
  valid(!levels.length || t !== null, 'undated price ladder')
  return {
    id,
    house: house.key,
    history,
    method,
    book: {
      t,
      source: SOURCE,
      house: house.key,
      method: 'order-book/v1',
      resolution: 'item-id',
      levels,
      more,
    },
  }
}

export function normalizeRecipes(raw) {
  valid(
    Array.isArray(raw?.recipes) && raw.items && raw.vendor,
    'missing recipe catalog',
  )
  const entries = raw.recipes.map((r) => {
    valid(
      typeof r.name === 'string' &&
        typeof r.prof === 'string' &&
        Array.isArray(r.r),
      'invalid recipe',
    )
    const output = r.item === null ? null : integer(r.item, 'recipe output', 1)
    const inputs = r.r.map(([id, qty]) => ({
      id: integer(id, 'reagent', 1),
      qty: integer(qty, 'reagent quantity', 1),
    }))
    return {
      id: integer(r.id, 'recipe id', 1),
      name: r.name,
      profession: r.prof,
      output,
      quantity: integer(r.qty, 'output quantity', 1),
      inputs,
    }
  })
  valid(
    entries.some(
      (r) =>
        r.output !== null &&
        raw.items[r.output] &&
        r.inputs.length &&
        r.inputs.every((i) => raw.items[i.id]),
    ),
    'no recipe with linked product and reagents',
  )
  const vendor = Object.entries(raw.vendor).map(([id, price]) => ({
    id: integer(Number(id), 'vendor item', 1),
    price: integer(price, 'vendor purchase price'),
  }))
  return { entries, vendor }
}

export function tierUnits(row, book) {
  if (row.ask == null || row.listed == null) return null
  if (
    book &&
    book.t === row.t &&
    book.house === row.house &&
    book.source === row.source &&
    book.levels[0]?.price === row.ask &&
    book.levels[0].units <= row.listed
  )
    return book.levels[0].units
  // A second price exactly at 105% is included in depth5.
  if (
    row.depth != null &&
    row.ask2 != null &&
    BigInt(row.ask2) * 100n > BigInt(row.ask) * 105n
  )
    return row.depth
  return null
}

export function quoteLadder(book, requested) {
  integer(requested, 'quantity', 1)
  let shortfall = requested,
    cost = 0n
  for (const level of book?.levels ?? []) {
    const taken = Math.min(shortfall, level.units)
    cost += BigInt(taken) * BigInt(level.price)
    shortfall -= taken
    if (shortfall === 0) break
  }
  return {
    requested,
    filled: requested - shortfall,
    shortfall,
    totalCopper: String(cost),
    status: !book ? 'unavailable' : shortfall ? 'partial' : 'complete',
    t: book?.t ?? null,
    source: book?.source ?? null,
    house: book?.house ?? null,
    more: book?.more ?? null,
    resolution: 'item-id',
  }
}

const consecutive = (a, b) =>
  Math.floor(b.t / HOUR) - Math.floor(a.t / HOUR) === 1 &&
  b.t - a.t <= 1.5 * HOUR
const EFFECTS = new Map([
  [
    940,
    {
      name: 'Mana-cost reduction',
      source: 'https://foreverchanges.pro/item/940/robes-of-insight',
    },
  ],
])

// Input consists only of observations available at the decision time. A missing slot breaks continuity.
export function scanItem(
  observations,
  currentTime,
  {
    slots = 8,
    minimum = 6,
    equality = 0.75,
    minUnits = 100,
    minShare = 0.5,
  } = {},
) {
  const current = observations.find((r) => r.t === currentTime)
  if (!current) return []
  const cutoff = Math.floor(currentTime / HOUR) - slots + 1
  const bySlot = new Map()
  for (const row of observations) {
    const slot = Math.floor(row.t / HOUR)
    if (
      row.id !== current.id ||
      row.house !== current.house ||
      row.source !== current.source ||
      row.method !== current.method ||
      row.t > currentTime ||
      slot < cutoff ||
      bySlot.get(slot)?.t >= row.t
    )
      continue
    bySlot.set(slot, row)
  }
  const rows = [...bySlot.values()].sort((a, b) => a.t - b.t)
  const findings = []
  function add(rule, action, title, evidence, next, details = {}) {
    findings.push({
      rule,
      version: RULE_VERSION,
      action,
      title,
      evidence,
      next,
      ...details,
      id: current.id,
      name: current.name,
      t: currentTime,
      house: current.house,
      source: current.source,
      resolution: 'item-id',
    })
  }
  const validRows = rows.filter((r) => r.ask != null && r.sell > 0)
  const equalRows = validRows.filter((r) => r.ask === r.sell)
  if (
    current.ask !== null &&
    current.ask === current.sell &&
    validRows.length >= minimum &&
    equalRows.length >= validRows.length * equality
  )
    add(
      'vendor-pin',
      'hold',
      'Pinned to vendor',
      equalRows.length +
        '/' +
        validRows.length +
        ' observed asks matched vendor; ' +
        validRows.length +
        '/' +
        slots +
        ' hourly slots covered.',
      'Look for sustained asks above the vendor value.',
      { matched: equalRows.length, observed: validRows.length, slots },
    )
  const floor = current.floor
  if (
    current.commodity &&
    current.sell > 0 &&
    current.ask === current.sell &&
    floor != null &&
    floor >= minUnits &&
    current.listed > 0 &&
    floor / current.listed >= minShare
  )
    add(
      'floor-wall',
      'hold',
      'Concentrated vendor floor',
      floor +
        ' of ' +
        current.listed +
        ' listed units at ' +
        current.ask +
        ' copper.',
      'Watch the next exact tier for a change in displayed depth.',
      { floor, listed: current.listed, nextAsk: current.ask2 },
    )
  const last = rows.slice(-3)
  if (
    last.length === 3 &&
    current.commodity &&
    current.sell > 0 &&
    last.every(
      (r) => r.floor != null && r.ask === current.ask && r.sell === r.ask,
    ) &&
    consecutive(last[0], last[1]) &&
    consecutive(last[1], last[2])
  ) {
    const down = last[1].floor - last[0].floor,
      up = last[2].floor - last[1].floor
    if (down < 0 && up > 0)
      add(
        'floor-refill',
        'hold',
        'Observed floor refill',
        down + ' then +' + up + ' units at the same displayed price.',
        'A later book can show persistence. Seller identity and sales are unknown.',
        { down, up },
      )
  }
  const previous = rows.at(-2)
  if (
    previous &&
    consecutive(previous, current) &&
    previous.listed >= 100 &&
    current.listed != null &&
    current.listed * 2 <= previous.listed
  )
    add(
      'supply-drop',
      'supply',
      'Listed supply contracted',
      previous.listed +
        ' → ' +
        current.listed +
        ' units in consecutive observations.',
      'Check cancellations, expiry and the next book before sourcing stock.',
    )
  if (!current.commodity && EFFECTS.has(current.id)) {
    const effect = EFFECTS.get(current.id)
    add(
      'effect-lead',
      'hold',
      'Inspect a distinctive equipment effect',
      effect.name + '; this house quotes the base item.',
      'Check the variant and comparable settlements before estimating resale.',
      { effectSource: effect.source },
    )
  }
  return findings
}
