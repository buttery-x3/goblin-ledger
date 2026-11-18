import test from 'node:test';
import assert from 'node:assert/strict';
import { metricScale, colour, zoneSummary, matchesAtlasFilters } from './atlas-metrics.js';

test('cold start preserves unknown routes while a chosen time, basis or skill can narrow them', () => {
  const route = {
    profession: 'Herbalism',
    skill: 245,
    type: 'Gathering',
    yieldBasis: 'Personal runs',
    elapsedMinutes: 30,
    runCount: 2,
    approachMinutes: 10,
  };
  assert.ok(matchesAtlasFilters(route, {}, null));
  assert.ok(!matchesAtlasFilters(route, { sessionMinutes: 15 }, null));
  assert.ok(matchesAtlasFilters(route, { sessionMinutes: 30 }, null));
  assert.ok(matchesAtlasFilters({ ...route, runCount: 0 }, { sessionMinutes: 15 }, null));
  assert.ok(!matchesAtlasFilters(route, { yieldBasis: 'Demo scenario' }, null));
  assert.ok(
    !matchesAtlasFilters(
      route,
      { atlasActor: 'manual' },
      { professions: [{ name: 'Herbalism', skill: 200 }] },
    ),
  );
  assert.ok(
    matchesAtlasFilters(
      route,
      { atlasActor: 'manual' },
      { professions: [{ name: 'Herbalism', skill: 245 }] },
    ),
  );
});

test('unknown, zero, losing and profitable routes have distinct representations with a signed legend', () => {
  const list = [null, 0, -20000, 10000].map((n) => ({ rateCopperPerHour: n }));
  const tones = metricScale(list, 'rate');
  assert.deepEqual(tones, { known: true, low: -20000, high: 10000 });
  assert.equal(colour(null, tones), null);
  assert.equal(new Set(list.map((r) => colour(r.rateCopperPerHour, tones))).size, 4);
  assert.equal(metricScale([{ rateCopperPerHour: null }], 'rate').known, false);
  assert.deepEqual(metricScale([{ changeCopperPerHour: -100 }], 'change'), {
    low: -100,
    high: 0,
    known: true,
  });
});

test('zone change is the largest individual route change at a common baseline, even when the leader changed', () => {
  const basis = {
    yieldBasis: 'Personal runs',
    baselineTime: '2026-11-15T00:00:00Z',
    quote: { t: '2026-11-16T00:00:00Z' },
  };
  const a = { ...basis, id: 'a', name: 'West', rateCopperPerHour: 30000, changeCopperPerHour: -20000 };
  const b = { ...basis, id: 'b', name: 'East', rateCopperPerHour: 40000, changeCopperPerHour: 10000 };
  const summary = zoneSummary([a, b], 'change');
  assert.equal(summary.value, 10000);
  for (const label of [
    'East',
    'Personal runs',
    'Baseline',
    'Quote',
    '2 qualifying',
    'changed from West to East',
  ])
    assert.ok(summary.detail.includes(label));
  assert.doesNotMatch(zoneSummary([a, { ...b, baselineTime: null }], 'change').detail, /changed from/);
  assert.equal(zoneSummary([{ rateCopperPerHour: null }], 'rate').value, null);
});
