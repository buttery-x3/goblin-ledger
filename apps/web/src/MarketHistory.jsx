import React, { lazy, Suspense, useMemo, useState } from 'react'
import { metrics, prepareHistory } from './history-data.mjs'

const HistoryPlot = lazy(() => import('./HistoryPlot.jsx'))
const PAGE_SIZE = 24
const format = (t) =>
  new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })

export function History({ rows, method, articles }) {
  const [metric, setMetric] = useState('ask')
  const [page, setPage] = useState(0)
  const history = useMemo(
    () => prepareHistory(rows, metric, method, articles),
    [rows, metric, method, articles],
  )
  if (!history.rows.length) return <p>Waiting for hourly observations.</p>
  const observations = history.rows
  const lastPage = Math.ceil(observations.length / PAGE_SIZE) - 1
  const safePage = Math.min(page, lastPage)
  const end = observations.length - safePage * PAGE_SIZE
  return (
    <section>
      <div className="market-tools">
        <strong>Hourly observations</strong>
        <label>
          Chart{' '}
          <select
            value={metric}
            aria-label="Chart metric"
            onChange={(e) => setMetric(e.target.value)}
          >
            {Object.entries(metrics).map(([key, m]) => (
              <option value={key} key={key}>
                {m.name} ({m.unit})
              </option>
            ))}
          </select>
        </label>
      </div>
      <Suspense fallback={<p>Loading plot…</p>}>
        <HistoryPlot history={history} metric={metric} />
      </Suspense>
      <div className="market-meta">
        <span>
          {format(observations[0].t)} – {format(observations.at(-1).t)}
        </span>
        <span>
          {history.valid}/{observations.length} observed ·{' '}
          {metrics[metric].unit}
        </span>
      </div>
      {(history.gaps.length > 0 || history.missing.length > 0) && (
        <p>
          <small>
            {history.gaps.length > 0 &&
              history.gaps.length + ' shaded gap(s) between hourly samples. '}
            {history.missing.length > 0 &&
              history.missing.length +
                ' unavailable value(s), shown as grey diamonds.'}
          </small>
        </p>
      )}
      {metric === 'sold' && (
        <p>
          <small>
            {method
              ? 'Inference method v' +
                method.v +
                ' effective ' +
                format(method.since)
              : 'Provider method boundary unavailable.'}
            {history.boundaries.length > 0 &&
              ' Dashed lines mark changes in inference method.'}
          </small>
        </p>
      )}
      {history.researchDays.length > 0 && (
        <details>
          <summary>Research dates on the chart</summary>
          <p>
            <small>
              Green bands show the source’s calendar day on a UTC date grid.
              Publication times within those days are unknown.
            </small>
          </p>
          <ul>
            {history.researchDays.flatMap((d) =>
              d.events.map((event, i) => (
                <li key={d.day + '-' + i}>
                  {d.day} · {event.kind} ·{' '}
                  <a href={event.url} target="_blank" rel="noreferrer">
                    {event.title}
                  </a>
                </li>
              )),
            )}
          </ul>
        </details>
      )}
      <details>
        <summary>Observation table ({observations.length})</summary>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Observation time</th>
                <th>Ask / unit (c)</th>
                <th>Listed units</th>
                <th>Inferred units / compared interval</th>
                <th>Method</th>
              </tr>
            </thead>
            <tbody>
              {observations
                .slice(Math.max(0, end - PAGE_SIZE), end)
                .reverse()
                .map((row) => (
                  <tr key={row.t}>
                    <td>
                      <time dateTime={new Date(row.t).toISOString()}>
                        {format(row.t)}
                      </time>
                    </td>
                    {['ask', 'listed', 'sold'].map((key) => (
                      <td key={key}>
                        {row[key] == null
                          ? 'Unavailable'
                          : row[key].toLocaleString()}
                      </td>
                    ))}
                    <td>{row.method || 'Unknown'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {lastPage > 0 && (
          <div className="market-tools">
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Newer
            </button>
            <span>
              Page {safePage + 1} / {lastPage + 1}
            </span>
            <button
              disabled={safePage === lastPage}
              onClick={() => setPage(safePage + 1)}
            >
              Older
            </button>
          </div>
        )}
      </details>
    </section>
  )
}
