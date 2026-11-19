import React from 'react'

const lists = {
  rising: 'Rising asks (%)',
  falling: 'Falling asks (%)',
  added: 'Supply increases (units)',
  reduced: 'Supply decreases (units)',
  listed: 'Most listed now (units)',
}

function signedPercent(before, after) {
  const change = ((after - before) / before) * 100
  const magnitude = Math.abs(change)
  const value =
    magnitude < 0.1
      ? '<0.1'
      : magnitude.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return (change > 0 ? '+' : '−') + value + '%'
}

function Breadth({ label, counts, total }) {
  return (
    <tr>
      <td>{label}</td>
      <td>{counts.up.toLocaleString()}</td>
      <td>{counts.down.toLocaleString()}</td>
      <td>{counts.flat.toLocaleString()}</td>
      <td>
        {counts.compared.toLocaleString()} / {total.toLocaleString()}
      </td>
    </tr>
  )
}

export function HouseMarketOverview({
  data,
  pane,
  updatePane,
  money,
  when,
  openItem,
}) {
  const analysis = data.overview
  if (!analysis) return null
  const { baseline, leaders } = analysis
  const available = baseline ? Object.keys(lists) : ['listed']
  const first = available.find((key) => leaders[key].length) ?? available[0]
  const selected = available.includes(pane.houseLeader)
    ? pane.houseLeader
    : first
  const price = selected === 'rising' || selected === 'falling'
  const listing = selected === 'listed'
  const unitValue = (value) => (price ? money(value) : value.toLocaleString())
  const current = data.snapshot
  const itemCount = current.count.toLocaleString()
  const totalUnits =
    analysis.knownListedUnits == null
      ? 'Unknown'
      : BigInt(analysis.knownListedUnits).toLocaleString()
  return (
    <section aria-label="Auction house market overview">
      <div className="market-kpis">
        <div>
          <small>Items in snapshot</small>
          <b>{itemCount}</b>
        </div>
        <div>
          <small>Known listed units</small>
          <b>{totalUnits}</b>
        </div>
        <div>
          <small>Items with an ask</small>
          <b>{analysis.itemsWithAsk.toLocaleString()}</b>
        </div>
      </div>
      {analysis.itemsWithUnits < current.count && (
        <p>
          <small>
            Quantity reported for {analysis.itemsWithUnits.toLocaleString()} of{' '}
            {itemCount} items.
          </small>
        </p>
      )}
      <div className="market-tools">
        <label>
          Compare with{' '}
          <select
            value={analysis.window}
            onChange={(e) => updatePane({ houseWindow: e.target.value })}
          >
            <option value="previous">Previous scan</option>
            <option value="24h">24 hours earlier</option>
            <option value="7d">7 days earlier</option>
          </select>
        </label>
        {baseline && (
          <small>
            {when(baseline.t)} → {when(current.t)}
          </small>
        )}
      </div>
      {baseline ? (
        <>
          <table aria-label="Breadth of item changes">
            <thead>
              <tr>
                <th>Measure</th>
                <th>Up</th>
                <th>Down</th>
                <th>Flat</th>
                <th>Compared / current</th>
              </tr>
            </thead>
            <tbody>
              <Breadth
                label="Unit ask"
                counts={analysis.asks}
                total={current.count}
              />
              <Breadth
                label="Listed units"
                counts={analysis.supply}
                total={current.count}
              />
            </tbody>
          </table>
          <p>
            <small>
              {analysis.newItems.toLocaleString()} item IDs only in the later scan ·{' '}
              {analysis.absentItems.toLocaleString()} item IDs only in the earlier scan.
              Changes compare matched items with values in both scans.
            </small>
          </p>
        </>
      ) : (
        <p className="market-state">
          {analysis.window === 'previous'
            ? 'The next comparable house scan will show what moved.'
            : 'There is no archived scan within one hour of that comparison time.'}
        </p>
      )}
      <div className="market-tools">
        <label>
          Inspect{' '}
          <select
            value={selected}
            onChange={(e) => updatePane({ houseLeader: e.target.value })}
          >
            {available.map((k) => (
              <option key={k} value={k}>
                {lists[k]}
              </option>
            ))}
          </select>
        </label>
        {!!leaders[selected].length && (
          <small>
            {data.asOf != null
              ? 'Open current item details'
              : 'Open an item for its history and price tiers'}
          </small>
        )}
      </div>
      {leaders[selected].length ? (
        <table aria-label={lists[selected]}>
          <thead>
            <tr>
              <th>Item</th>
              {listing ? (
                <>
                  <th>Listed units</th>
                  <th>Unit ask</th>
                </>
              ) : (
                <>
                  <th>Before</th>
                  <th>After</th>
                  <th>Change</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {leaders[selected].map((row) => (
              <tr key={row.id}>
                <td>
                  <button
                    type="button"
                    className="market-link"
                    onClick={() => openItem(row.id)}
                  >
                    {row.name || 'Item #' + row.id}
                  </button>
                </td>
                {listing ? (
                  <>
                    <td>{row.after.toLocaleString()}</td>
                    <td>{money(row.ask)}</td>
                  </>
                ) : (
                  <>
                    <td>{unitValue(row.before)}</td>
                    <td>{unitValue(row.after)}</td>
                    <td>
                      {price
                        ? signedPercent(row.before, row.after)
                        : (row.delta > 0 ? '+' : '−') +
                          Math.abs(row.delta).toLocaleString()}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No qualifying items for this measure in these observations.</p>
      )}
      {(selected === 'added' || selected === 'reduced') && (
        <small>
          Supply changes measure units displayed at each scan. Sales, expiry and
          cancellations can all affect the total.
        </small>
      )}
    </section>
  )
}
