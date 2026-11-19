import React, { useEffect, useState } from 'react'
import { ItemUseEvidence } from './ItemUseEvidence.jsx'
import { History } from './MarketHistory.jsx'
import { useMarketRead, refreshMarketReads } from './market-query.js'
import './markets.css'
import { HouseMarketOverview } from './HouseMarketOverview.jsx'
import { ItemActivities } from './ItemActivities.jsx'

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
  if (data && !data.snapshot && data.asOf != null)
    return <p className="market-state">No house snapshot was available by this decision time.</p>
  if (data && !data.snapshot)
    return (
      <p className="market-state">
        Waiting for the first complete house snapshot. Status / Console shows
        the last collection attempt.
      </p>
    )
  return null
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
function Detail({ id, api, mode, region, refresh, goBack, routes, onSelectRoute }) {
  const [quantity, setQuantity] = useState(1)
  const { data, loading, error } = useMarketRead(
    api,
    '/markets/' + id + '?quantity=' + quantity,
    mode,
    region,
    refresh,
  )
  const research = useMarketRead(
    api,
    '/research?itemId=' + id,
    mode,
    region,
    refresh,
  )
  const job = useJob(api, () => refreshMarketReads(api, mode, region))
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
            <ItemActivities itemId={Number(id)} routes={routes} onSelectRoute={onSelectRoute}
              api={api} mode={mode} region={region} refresh={refresh}/>
            <History
              rows={data.history}
              method={data.detail?.method}
              articles={research.data?.items}
            />
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
            {research.error && <p role="alert">Could not load item research. {research.error}</p>}
            {research.data?.items.some(r => r.useThesis) && <section>
              <h4>Item-use thesis</h4>
              {research.data.items.filter(r => r.useThesis).map(r => <ItemUseEvidence key={r.id} record={r}/>)}
            </section>}
            {research.data?.items?.some(r => !r.useThesis) && (
              <section>
                <h4>Dated research</h4>
                {research.data.items.filter(r => !r.useThesis).map((r) => (
                  <p key={r.id}>
                    {r.url ? <a href={r.url} target="_blank" rel="noreferrer">
                      {r.title}
                    </a> : r.title}{' '}
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
  routes = [],
  onSelectRoute,
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

  const { data, loading, error } = useMarketRead(
    api,
    marketItem
      ? null
      : '/markets?' +
          new URLSearchParams({ q: query, sort, direction, offset, limit: 40 }),
    mode,
    region,
    refreshKey,
  )
  const job = useJob(api, () => refreshMarketReads(api, mode, region))
  if (marketItem)
    return (
      <Detail
        key={region + '-' + marketItem}
        id={marketItem}
          routes={routes}
          onSelectRoute={onSelectRoute}
        region={region}
        api={api}
        mode={mode}
        refresh={refreshKey}
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
        {/^\d{1,10}$/.test(query) &&
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
  routes = [],
  onSelectRoute,
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
    opportunityView = 'house',
    houseWindow = 'previous',
  } = pane

  const houseView = opportunityView !== 'signals'
  const params = new URLSearchParams(
    houseView
      ? { view: 'house', window: houseWindow }
      : { action, order, offset, limit: 30 },
  )
  if (asOf && Number.isFinite(Date.parse(asOf)))
    params.set('asOf', String(Date.parse(asOf)))
  const { data, error, loading } = useMarketRead(
    api,
    opportunityItem ? null : '/opportunities?' + params,
    mode,
    region,
    refreshKey,
  )
  if (opportunityItem)
    return (
      <Detail
        key={region + '-' + opportunityItem}
        id={opportunityItem}
          routes={routes}
          onSelectRoute={onSelectRoute}
        region={region}
        api={api}
        mode={mode}
        refresh={refreshKey}
        goBack={() => updatePane({ opportunityItem: null })}
      />
    )
  const rows = data?.items ?? []
  return (
    <div className="market-body">
      <div
        className="market-tools"
        role="group"
        aria-label="Opportunities view"
      >
        <button
          type="button"
          aria-pressed={houseView}
          onClick={() => updatePane({ opportunityView: 'house' })}
        >
          House trends
        </button>
        <button
          type="button"
          aria-pressed={!houseView}
          onClick={() => updatePane({ opportunityView: 'signals' })}
        >
          Signal scanner
        </button>
      </div>
      {!houseView && (
        <div className="market-tools">
          <label>
            Action{' '}
            <select
              value={action}
              onChange={(e) =>
                updatePane({ action: e.target.value, offset: 0 })
              }
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
      )}
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
          {houseView ? (
            <HouseMarketOverview
              data={data}
              pane={pane}
              updatePane={updatePane}
              money={money}
              when={when}
              openItem={(id) => updatePane({ opportunityItem: id })}
            />
          ) : (
            <>
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
                    onClick={() =>
                      updatePane({ offset: Math.max(0, offset - 30) })
                    }
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
        </>
      )}
    </div>
  )
}
