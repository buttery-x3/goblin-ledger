import { test } from 'node:test'
import assert from 'node:assert/strict'
import { prepareHistory, marketReadKey } from './history-data.mjs'

const HOUR = 3600000
const t = Date.UTC(2026, 10, 18, 12, 17)
const sample = (n, override = {}) => ({
  t: t + n * HOUR,
  ask: 100 + n,
  listed: 200,
  sold: 2,
  method: 'v1',
  ...override,
})

test('chronological rows use actual millisecond times; null, zero and missing hours are distinct', () => {
  const r = prepareHistory(
    [sample(4, { sold: 0 }), sample(1, { sold: null }), sample(0), sample(3)],
    'sold',
  )
  assert.deepEqual(
    r.rows.map((x) => x.t),
    [t, t + HOUR, t + 3 * HOUR, t + 4 * HOUR],
  )
  assert.deepEqual(
    r.segments.map((s) => s.points.map((p) => p[1])),
    [[2], [2, 0]],
  )
  assert.deepEqual(r.missing, [t + HOUR])
  assert.deepEqual(r.gaps, [{ from: t + HOUR, to: t + 3 * HOUR }])
  assert.equal(r.valid, 3)
})

test('chart splits flows at real method times and preserves comparable ask lines', () => {
  const change = t + 1.5 * HOUR
  const rows = [
    sample(0),
    sample(1),
    sample(2, { method: 'v2' }),
    sample(3, { method: 'v2' }),
  ]
  const methods = { v: 2, since: change }
  const result = prepareHistory(rows, 'sold', methods)
  assert.deepEqual(result.boundaries, [change])
  assert.deepEqual(
    result.segments.map((s) => s.points.length),
    [2, 2],
  )
  assert.equal(prepareHistory(rows, 'ask', methods).segments.length, 1)
  assert.equal(
    prepareHistory(
      rows.map((r) => ({ ...r, method: 'unknown' })),
      'sold',
      methods,
    ).segments.length,
    2,
  )
})

test('research bands use publication, revision and effective days without placing later advice in an earlier window', () => {
  const day = Date.UTC(2026, 10, 17)
  const rows = [
    { t: day + 23 * HOUR, ask: 1 },
    { t: day + 26 * HOUR, ask: 2 },
  ]
  const article = {
    title: 'Herb route',
    url: 'https://example.com/guide',
    publishedOn: '2026-11-18',
    revisedOn: '2026-11-18',
    effectiveOn: '2026-11-20',
  }
  const bands = prepareHistory(rows, 'ask', null, [
    article,
    { ...article, publishedOn: null, revisedOn: null },
  ]).researchDays
  assert.equal(bands.length, 1)
  assert.deepEqual(
    [bands[0].from, bands[0].to],
    [day + 24 * HOUR, day + 26 * HOUR],
  )
  assert.deepEqual(
    bands[0].events.map((e) => e.kind),
    ['Published', 'Revised'],
  )
  assert.equal(
    prepareHistory(rows.slice(0, 1), 'ask', null, [article]).researchDays
      .length,
    0,
  )
})

test('single observations and entirely unavailable windows retain their dates and coverage', () => {
  const all = prepareHistory(
    [sample(0, { sold: null }), sample(1, { sold: null })],
    'sold',
  )
  assert.equal(all.valid, 0)
  assert.deepEqual(all.missing, [t, t + HOUR])
  assert.deepEqual(prepareHistory([sample(0)], 'ask').segments[0].points, [
    [t, 100],
  ])
  assert.equal(
    prepareHistory([sample(0), sample(0, { ask: 80 })], 'ask').valid,
    1,
  )
})

test('shared reads isolate profile, selected house, revision and requested quantity, excluding provider checks', () => {
  const key = (path, mode = 'live', region = 'us', rev = 1) =>
    marketReadKey(path, mode, region, rev)
  const ref = key('/markets/8845?quantity=20')
  assert.deepEqual(ref, key('/markets/8845?quantity=20'))
  assert.notDeepEqual(ref, key('/markets/8845?quantity=1'))
  assert.notDeepEqual(ref, key('/markets/8845?quantity=20', 'demo'))
  assert.notDeepEqual(ref, key('/markets/8845?quantity=20', 'live', 'eu'))
  assert.notDeepEqual(ref, key('/markets/8845?quantity=20', 'live', 'us', 2))
  for (const path of [
    '/markets/8845/crosscheck',
    '/crosscheck',
    '/markets/refresh',
    '/markets/8845/detail',
  ])
    assert.throws(() => key(path))
})
