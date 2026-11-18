import React, { useEffect, useState } from 'react'
import './markets.css'

const number = (value) => (value == null ? '—' : Number(value).toLocaleString())
function money(value) {
  if (value == null) return '—'
  const copper = BigInt(value),
    gold = copper / 10000n,
    silver = (copper / 100n) % 100n,
    coins = copper % 100n
  return [
    gold && gold.toLocaleString() + 'g',
    silver && silver + 's',
    coins || !copper ? coins + 'c' : '',
  ]
    .filter(Boolean)
    .join(' ')
}
const when = (t) =>
  t
    ? new Date(t).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Unknown'
function useData(api, path, refresh) {
  const [result, setResult] = useState({ loading: true })
  useEffect(() => {
    let active = true
    if (!path) {
      setResult({ loading: false })
      return
    }
    setResult({ loading: true })
    api(path).then(
      (data) => {
        if (active) setResult({ data, loading: false })
      },
      (error) => {
        if (active) setResult({ error: error.message, loading: false })
      },
    )
    return () => {
      active = false
    }
  }, [api, path, refresh])
  return result
}
function useJob(api, reload) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('')
  async function run(path) {
    setBusy(true)
    setMessage('')
    try {
      const r = await api(path, { method: 'POST', body: {} })
      if (r?.held) setMessage('Next request ' + when(r.next))
      reload()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, run }
}
function Snapshot({ info }) {
  return (
    <div className="market-meta">
      <span>
        {info.mode === 'demo' ? 'Synthetic observations' : 'AuctionHouse.tk.gg'}
      </span>
      {info.snapshot && (
        <span>
          {info.house} · {when(info.snapshot.t)}
        </span>
      )}
    </div>
  )
}
function Waiting({ data, error, loading }) {
  if (error)
    return (
      <p role="alert" className="market-state">
        {error}
      </p>
    )
  if (loading) return <p className="market-state">Reading the local archive…</p>
  if (data?.status === 'choose-region')
    return (
      <p className="market-state">
        Choose US or EU in Settings to collect your PvP Alliance house.
      </p>
    )
  if (data && !data.snapshot)
    return (
      <p className="market-state">
        Waiting for the first complete house snapshot. Status / Console shows
        the last collection attempt.
      </p>
    )
  return null
}
function History({ rows, method }) {
  const [metric, setMetric] = useState('ask')
  if (!rows?.length) return <p>Waiting for hourly observations.</p>
  const vals = rows.map((r) => r[metric]).filter((x) => x != null)
  const format = metric === 'ask' ? money : number
  const min = vals.length ? Math.min(...vals) : 0,
    max = vals.length ? Math.max(...vals) : 0
  const lo = rows[0].t,
    hi = rows.at(-1).t
  const x = (t) => 12 + ((t - lo) / Math.max(1, hi - lo)) * 416
  const y = (v) => (max === min ? 35 : 62 - ((v - min) / (max - min)) * 54)
  return (
    <section>
      <div className="market-tools">
        <strong>Hourly observations</strong>
        <select
          value={metric}
          aria-label="Chart metric"
          onChange={(e) => setMetric(e.target.value)}
        >
          <option value="ask">Ask per unit</option>
          <option value="listed">Listed units</option>
          <option value="sold">Inferred units sold</option>
        </select>
      </div>
      {vals.length ? (
        <>
          <svg
            className="market-chart"
            viewBox="0 0 440 74"
            role="img"
            aria-label={
              metric +
              ' from ' +
              when(lo) +
              ' to ' +
              when(hi) +
              ', range ' +
              format(min) +
              ' to ' +
              format(max)
            }
          >
            {[12, 35, 60].map((n) => (
              <line
                key={n}
                x1="12"
                x2="428"
                y1={n}
                y2={n}
                className="market-grid"
              />
            ))}
            {rows.map((r, i) => {
              const prev = rows[i - 1]
              if (r[metric] == null) return null
              const connected =
                prev &&
                prev[metric] != null &&
                r.t - prev.t < 5_400_000 &&
                (metric !== 'sold' || r.method === prev.method)
              return (
                <g key={r.t}>
                  {connected && (
                    <line
                      x1={x(prev.t)}
                      y1={y(prev[metric])}
                      x2={x(r.t)}
                      y2={y(r[metric])}
                    />
                  )}
                  <circle cx={x(r.t)} cy={y(r[metric])} r="2.3">
                    <title>
                      {when(r.t) + ' · ' + format(r[metric]) + ' · ' + r.method}
                    </title>
                  </circle>
                </g>
              )
            })}
          </svg>
          <div className="market-meta">
            <span>
              {when(lo)} — {when(hi)}
            </span>
            <span>
              {format(min)}–{format(max)} · {vals.length}/{rows.length}{' '}
              observations
            </span>
          </div>
        </>
      ) : (
        <p>Flow data unavailable for this window.</p>
      )}
      {metric === 'sold' && (
        <small>
          {method
            ? 'Provider method v' + method.v + ' from ' + when(method.since)
            : 'Method boundary unavailable'}
        </small>
      )}
    </section>
  )
}
function Crosscheck({ api, id }) {
  const [state, setState] = useState({})
  const expiry = state.result?.expires
  useEffect(() => {
    if (expiry == null) return
    const clear = () => {
      if (Date.now() >= expiry)
        setState({ message: 'This source check has expired.' })
    }
    const timer = setTimeout(clear, Math.max(0, expiry - Date.now()))
    document.addEventListener('visibilitychange', clear)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', clear)
    }
  }, [expiry])
  async function check() {
    setState({ busy: true })
    try {
      const result = await api('/markets/' + id + '/crosscheck', {
        method: 'POST',
        body: {},
      })
      setState(
        result.expires != null && result.expires <= Date.now()
          ? { message: 'This scan response has already expired.' }
          : { result },
      )
    } catch (error) {
      setState({ message: error.message })
    }
  }
  const r = state.result
  return (
    <section>
      <h4>Independent price check</h4>
      <button disabled={state.busy} onClick={check}>
        {state.busy ? 'Checking…' : 'Check AHledger player scan'}
      </button>
      {state.message && <p role="status">{state.message}</p>}
      {r && (
        <>
          <p>
            {r.observedAt
              ? [
                  r.name || 'Item ' + id,
                  money(r.ask) + ' minimum buyout',
                  number(r.listed) + ' units',
                  number(r.auctions) + ' auctions',
                ].join(' · ')
              : 'No dated scan available.'}
          </p>
          <small>
            {r.market} · {r.method} · {when(r.observedAt)} ·{' '}
            <a href={r.url} target="_blank" rel="noreferrer">
              Prices from AHledger
            </a>
          </small>
        </>
      )}
    </section>
  )
}
function Detail({ id, api, mode, region, refresh, goBack }) {
  const [quantity, setQuantity] = useState(1),
    [local, setLocal] = useState(0)
  const key = refresh + '-' + local
  const { data, loading, error } = useData(
    api,
    '/markets/' + id + '?quantity=' + quantity,
    key,
  )
  const research = useData(api, '/research?itemId=' + id, key)
  const job = useJob(api, () => setLocal((n) => n + 1))
  const book = data?.detail?.book,
    quote = data?.quote
  return (
    <div className="market-body">
      <button className="market-back" onClick={goBack}>
        ← Results
      </button>
      {loading || error ? (
        <Waiting loading={loading} error={error} />
      ) : (
        data && (
          <>
            <h3>{data.item?.name ?? 'Item ' + id}</h3>
            <Snapshot info={data} />
            <div className="market-meta">
              <span>#{id} · Base-item resolution</span>
              <span>{data.item?.category}</span>
            </div>
            {data.item ? (
              <div className="market-kpis">
                {[
                  ['Lowest ask', money(data.item.ask)],
                  ['Listed units', number(data.item.listed)],
                  ['Auctions', number(data.item.listings)],
                  ['Est. sold · 24h', number(data.item.sold)],
                  ['Est. traded · 24h', money(data.item.traded)],
                  ['Flow hours', number(data.item.hours)],
                ].map(([label, v]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <b>{v}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                {data.snapshot
                  ? 'Absent from the latest complete overview. No current ask.'
                  : 'Awaiting a house snapshot.'}
              </p>
            )}
            <History rows={data.history} method={data.detail?.method} />
            <h4>Price ladder</h4>
            <div className="market-meta">
              <span>
                {book?.t
                  ? 'Book observed ' + when(book.t)
                  : 'No observed ladder'}
              </span>
              {book && (
                <span>
                  {book.more
                    ? book.more + ' additional levels omitted'
                    : 'All reported levels'}
                </span>
              )}
            </div>
            {book?.levels.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Unit ask</th>
                    <th>Units</th>
                    <th>Auctions</th>
                  </tr>
                </thead>
                <tbody>
                  {book.levels.map((l) => (
                    <tr key={l.price}>
                      <td>{money(l.price)}</td>
                      <td>{number(l.units)}</td>
                      <td>{number(l.auctions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {mode === 'live' && data.item && (
              <button
                disabled={job.busy}
                onClick={() => job.run('/markets/' + id + '/detail')}
              >
                {job.busy ? 'Checking…' : 'Check item history & tiers'}
              </button>
            )}
            {job.message && <p role="status">{job.message}</p>}
            <label className="market-quote">
              Buy quantity{' '}
              <input
                type="number"
                min="1"
                max="1000000000"
                value={quantity}
                onChange={(e) =>
                  setQuantity(
                    Math.max(
                      1,
                      Math.min(1e9, Math.floor(+e.target.value || 1)),
                    ),
                  )
                }
              />
            </label>
            <p>
              {quote.status === 'unavailable'
                ? 'A contemporaneous price ladder is needed to quote this order.'
                : money(quote.totalCopper) +
                  ' for ' +
                  number(quote.filled) +
                  ' units' +
                  (quote.shortfall
                    ? ' · ' + number(quote.shortfall) + ' units unpriced.'
                    : '.')}
            </p>
            {data.uses?.length > 0 && (
              <section>
                <h4>Recipe connections</h4>
                {data.uses.map((r) => (
                  <div key={r.id}>
                    {r.name} · {r.profession}
                  </div>
                ))}
              </section>
            )}
            {research.data?.items?.length > 0 && (
              <section>
                <h4>Dated research</h4>
                {research.data.items.map((r) => (
                  <p key={r.id}>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a>{' '}
                    · {r.publishedOn || 'Publication date unknown'}
                  </p>
                ))}
              </section>
            )}
            <div className="market-meta">
              <span>{data.mapping}</span>
              {mode === 'live' && data.house && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={'https://auctionhouse.tk.gg/m/' + data.house + '/' + id}
                >
                  Provider history ↗
                </a>
              )}
            </div>
          </>
        )
      )}
      {mode === 'live' && region && (
        <Crosscheck key={region + '-' + id} api={api} id={id} />
      )}
    </div>
  )
}

export function Markets({
  api,
  mode,
  region,
  pane = {},
  updatePane,
  refreshKey = 0,
}) {
  const {
    query = '',
    sort = 'name',
    direction = 'asc',
    offset = 0,
    marketItem = null,
  } = pane
  const [local, setLocal] = useState(0)
  const key = [mode, region, refreshKey, local].join('-')
  const { data, loading, error } = useData(
    api,
    marketItem
      ? null
      : '/markets?' +
          new URLSearchParams({ q: query, sort, direction, offset, limit: 40 }),
    key,
  )
  const job = useJob(api, () => setLocal((n) => n + 1))
  if (marketItem)
    return (
      <Detail
        key={region + '-' + marketItem}
        id={marketItem}
        region={region}
        api={api}
        mode={mode}
        refresh={key}
        goBack={() => updatePane({ marketItem: null })}
      />
    )
  const sortBy = (s) =>
    updatePane({
      sort: s,
      direction: sort === s && direction === 'asc' ? 'desc' : 'asc',
      offset: 0,
    })
  return (
    <div className="market-body">
      <div className="market-tools">
        <input
          aria-label="Search market"
          type="search"
          placeholder="Item, ID, profession or reagent…"
          value={query}
          onChange={(e) => updatePane({ query: e.target.value, offset: 0 })}
        />
        {mode === 'live' &&
          region &&
          /^\d{1,10}$/.test(query) &&
          Number(query) > 0 && (
            <button onClick={() => updatePane({ marketItem: Number(query) })}>
              Look up #{query}
            </button>
          )}
        {mode === 'live' && region && (
          <button
            disabled={job.busy}
            onClick={() => job.run('/markets/refresh')}
          >
            {job.busy ? 'Collecting…' : 'Collect house'}
          </button>
        )}
      </div>
      {job.message && <p role="status">{job.message}</p>}
      <Waiting data={data} error={error} loading={loading} />
      {data?.snapshot && (
        <>
          <Snapshot info={data} />
          <table>
            <thead>
              <tr>
                {[
                  ['name', 'Item'],
                  ['ask', 'Unit ask'],
                  ['listed', 'Units'],
                  ['sold', 'Est. sold / 24h'],
                ].map(([s, label]) => (
                  <th
                    key={s}
                    aria-sort={
                      sort === s
                        ? direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button onClick={() => sortBy(s)}>
                      {label}
                      {sort === s ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button
                      className="market-link"
                      onClick={() => updatePane({ marketItem: r.id })}
                    >
                      {r.name ?? 'Item ' + r.id}
                    </button>
                  </td>
                  <td>{money(r.ask)}</td>
                  <td>{number(r.listed)}</td>
                  <td>{number(r.sold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.count && <p>No matching listings.</p>}
          <div className="market-tools">
            <small>{number(data.count)} matching items</small>
            {data.count > 40 && (
              <>
                <button
                  disabled={offset === 0}
                  onClick={() =>
                    updatePane({ offset: Math.max(0, offset - 40) })
                  }
                >
                  Previous
                </button>
                <button
                  disabled={offset + 40 >= data.count}
                  onClick={() => updatePane({ offset: offset + 40 })}
                >
                  Next
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
export function Opportunities({
  api,
  mode,
  region,
  pane = {},
  updatePane,
  refreshKey = 0,
}) {
  const {
    action = 'all',
    order = 'signal',
    asOf = '',
    offset = 0,
    opportunityItem = null,
  } = pane
  const key = [mode, region, refreshKey].join('-')
  const params = new URLSearchParams({ action, order, offset, limit: 30 })
  if (asOf && Number.isFinite(Date.parse(asOf)))
    params.set('asOf', String(Date.parse(asOf)))
  const { data, error, loading } = useData(
    api,
    opportunityItem ? null : '/opportunities?' + params,
    key,
  )
  if (opportunityItem)
    return (
      <Detail
        key={region + '-' + opportunityItem}
        id={opportunityItem}
        region={region}
        api={api}
        mode={mode}
        refresh={key}
        goBack={() => updatePane({ opportunityItem: null })}
      />
    )
  const rows = data?.items ?? []
  return (
    <div className="market-body">
      <div className="market-tools">
        <label>
          Action{' '}
          <select
            value={action}
            onChange={(e) => updatePane({ action: e.target.value, offset: 0 })}
          >
            {['all', 'hold', 'supply'].map((a) => (
              <option key={a} value={a}>
                {a === 'all' ? 'All actions' : a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort{' '}
          <select
            value={order}
            onChange={(e) => updatePane({ order: e.target.value, offset: 0 })}
          >
            <option value="signal">Signal</option>
            <option value="name">Item name</option>
          </select>
        </label>
      </div>
      <details className="market-replay" open={asOf ? true : undefined}>
        <summary>Historical replay</summary>
        <label>
          Decision time (local){' '}
          <input
            type="datetime-local"
            value={asOf}
            onChange={(e) => updatePane({ asOf: e.target.value, offset: 0 })}
          />
        </label>
        {asOf && (
          <button onClick={() => updatePane({ asOf: '', offset: 0 })}>
            Return to latest
          </button>
        )}
      </details>
      <Waiting data={data} error={error} loading={loading} />
      {data?.snapshot && (
        <>
          <Snapshot info={data} />
          {!rows.length && (
            <p>
              No qualifying signals in this house snapshot for the selected
              action.
            </p>
          )}
          {rows.map((r) => (
            <details className="market-signal" key={r.rule + '-' + r.id}>
              <summary>
                <span>{r.title}</span>
                <strong>{r.name ?? 'Item ' + r.id}</strong>
              </summary>
              <p>{r.evidence}</p>
              <p>{r.next}</p>
              {r.effectSource && (
                <a href={r.effectSource} target="_blank" rel="noreferrer">
                  Effect reference ↗{' '}
                </a>
              )}
              <button onClick={() => updatePane({ opportunityItem: r.id })}>
                {asOf ? 'Inspect current listings' : 'Inspect item'}
              </button>
              <small> {r.version}</small>
            </details>
          ))}
          {data.count > 30 && (
            <div className="market-tools">
              <small>
                {offset + 1}–{Math.min(offset + 30, data.count)} of{' '}
                {number(data.count)}
              </small>
              <button
                disabled={!offset}
                onClick={() => updatePane({ offset: Math.max(0, offset - 30) })}
              >
                Previous
              </button>
              <button
                disabled={offset + 30 >= data.count}
                onClick={() => updatePane({ offset: offset + 30 })}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
