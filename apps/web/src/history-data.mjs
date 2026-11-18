const HOUR = 3600000

export const metrics = {
  ask: { name: 'Lowest ask', unit: 'copper / unit' },
  listed: { name: 'Listed supply', unit: 'units listed' },
  sold: { name: 'Inferred sales', unit: 'units / compared interval' },
}

function researchDays(articles, rows) {
  if (!rows.length) return []
  const byDay = new Map()
  const min = rows[0].t,
    max = rows.at(-1).t
  for (const article of articles) {
    for (const [key, kind] of [
      ['publishedOn', 'Published'],
      ['revisedOn', 'Revised'],
      ['effectiveOn', 'Effective'],
      ['observedAt', 'Hand-in observed'],
    ]) {
      const day = key === 'observedAt' ? article.observedAt?.slice(0, 10) : article[key]
      if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
      const from = Date.parse(day + 'T00:00:00Z'),
        to = from + 24 * HOUR
      if (
        !Number.isFinite(from) ||
        new Date(from).toISOString().slice(0, 10) !== day ||
        to <= min ||
        from > max
      )
        continue
      const band = byDay.get(day) ?? {
        day,
        from: Math.max(min, from),
        to: Math.min(max, to),
        events: [],
      }
      band.events.push({ title: article.title, url: article.url, kind })
      byDay.set(day, band)
    }
  }
  return [...byDay.values()].sort((a, b) => a.from - b.from)
}

export function prepareHistory(input, metric, method, articles = []) {
  if (!Object.hasOwn(metrics, metric)) throw Error('Unknown history metric')
  const observations = new Map()
  for (const row of input ?? []) {
    if (Number.isSafeInteger(row?.t) && row.t > 0) observations.set(row.t, row)
  }
  const rows = [...observations.values()].sort((a, b) => a.t - b.t)
  const segments = [],
    missing = [],
    gaps = [],
    boundaries = new Set()
  let previous,
    segment,
    valid = 0
  const usesMethod = metric === 'sold'
  for (const row of rows) {
    const value = row[metric]
    const measured = Number.isSafeInteger(value) && value >= 0
    const gap = previous && row.t - previous.t > HOUR * 1.5
    const change = usesMethod && previous && previous.method !== row.method
    if (gap) gaps.push({ from: previous.t, to: row.t })
    if (change) {
      const published = method?.since
      boundaries.add(
        Number.isSafeInteger(published) &&
          published > previous.t &&
          published <= row.t
          ? published
          : row.t,
      )
    }
    if (!measured) {
      missing.push(row.t)
      segment = null
    } else {
      if (!segment || change || gap) {
        segment = {
          method: usesMethod ? row.method || 'unknown' : null,
          points: [],
        }
        segments.push(segment)
      }
      segment.points.push([row.t, value])
      valid++
    }
    previous = row
  }
  // Keep an explicit provider boundary even if no sample lies exactly there.
  if (
    usesMethod &&
    rows.length &&
    Number.isSafeInteger(method?.since) &&
    method.since >= rows[0].t &&
    method.since <= rows.at(-1).t
  ) {
    boundaries.add(method.since)
    // A feed may publish the boundary before it populates row-level method tags.
    for (let i = segments.length - 1; i >= 0; i--) {
      const s = segments[i],
        pivot = s.points.findIndex(([t]) => t >= method.since)
      if (pivot <= 0) continue
      const next = { method: s.method, points: s.points.splice(pivot) }
      segments.splice(i + 1, 0, next)
    }
  }
  return {
    rows,
    segments,
    missing,
    gaps,
    boundaries: [...boundaries].sort((a, b) => a - b),
    researchDays: researchDays(articles, rows),
    valid,
  }
}

export function marketReadKey(path, mode, region, revision) {
  if (
    path &&
    !/^\/(?:markets(?:\/\d+)?|opportunities|research)(?:\?|$)/.test(path)
  ) {
    throw Error('Only local archive views can share these query results.')
  }
  return ['market-archive', mode, region ?? null, revision, path ?? null]
}
