import {
  HOUR,
  normalizeOverview,
  normalizeDetail,
} from '../../packages/domain/market.mjs'

// Deliberately synthetic. Relative prices and quantities are stable across launches.
export function demoData(region) {
  const house = {
    key: region + '-2-110',
    region,
    house: 110,
    ruleset: 2,
    grp: 1,
    faction: 'alliance',
  }
  const end = Date.UTC(2026, 10, 18, 13, 17)
  const f = [
    'listed',
    'ask',
    'listings',
    'ask2',
    'depth5',
    'vol24',
    'value24',
    'flowHours',
    'open24',
  ]
  const base = [
    [
      18945,
      'Dark Iron Residue',
      'Trade Goods',
      100,
      100,
      [
        [100, 750],
        [106, 40],
      ],
    ],
    [
      8845,
      'Ghost Mushroom',
      'Herb',
      10_000,
      375,
      [
        [10_000, 90],
        [10_800, 80],
      ],
    ],
    [
      3819,
      'Wintersbite',
      'Herb',
      1_000,
      125,
      [
        [1_000, 2],
        [1_800, 18],
      ],
    ],
    [4625, 'Firebloom', 'Herb', 400, 75, [[400, 90]]],
    [
      250946,
      'Mender’s Potion',
      'Consumable',
      3500,
      100,
      [
        [3500, 40],
        [3700, 20],
      ],
    ],
    [940, 'Robes of Insight', 'Cloth armor', 240_000, 9000, [[240_000, 1]]],
    [
      2589,
      'Linen Cloth',
      'Cloth',
      200,
      13,
      [
        [200, 125],
        [240, 20],
      ],
    ],
  ]
  const snapshots = [],
    details = []
  // Preserve the current books used by craft quotes. The earlier observations
  // give the house overview examples of both tightening and expanding supply.
  const examples = new Map([
    [2589, { ask: [125, 130, 140, 145, 160, 170, 180, 200], floor: [220, 210, 190, 180, 170, 150, 140, 125] }],
    [4625, { ask: [540, 520, 490, 480, 460, 440, 420, 400], floor: [55, 65, 70, 73, 81, 85, 88, 90] }],
  ])
  for (let i = 0; i < 8; i++) {
    const t = end - (7 - i) * HOUR
    const items = base.map(([id, name, cls, latestAsk, sell, tiers]) => {
      const example = examples.get(id)
      const ask = example?.ask[i] ?? latestAsk
      const floor =
        id === 18945 ? [650, 680, 675, 700, 780, 800, 200, 750][i] : (example?.floor[i] ?? tiers[0][1])
      const listed = floor + tiers.slice(1).reduce((n, r) => n + r[1], 0)
      return {
        id,
        name,
        cls,
        sell,
        nc: id === 940 ? 1 : undefined,
        o: [
          listed,
          ask,
          Math.min(listed, 12),
          tiers[1] ? tiers[1][0] + ask - latestAsk : null,
          floor,
          id === 940 ? null : 16,
          id === 940 ? null : ask * 16,
          7,
          ask,
        ],
      }
    })
    const snap = normalizeOverview({ house, t, f, items }, house, t)
    snap.source = 'demo'
    for (const row of snap.items) row.source = 'demo'
    snapshots.push(snap)
  }
  for (const [id, , , , , tiers] of base) {
    const f = ['ask', 'listed', 'sold']
    const history = snapshots.map((s) => s.items.find((r) => r.id === id))
    const item = normalizeDetail(
      {
        house,
        item: { id },
        f,
        series: {
          t: history.map((r) => r.t),
          ask: history.map(r => r.ask),
          listed: history.map((r) => r.listed),
          sold: history.map(() => (id === 940 ? null : 2)),
        },
        book: tiers.map(([price, units]) => [price, units, 1]),
        bookT: end,
        bookMore: 0,
        method: { v: 2, since: end - 5 * HOUR },
      },
      house,
      id,
    )
    item.book.source = 'demo'
    details.push(item)
  }
  return { house, snapshots, details }
}
