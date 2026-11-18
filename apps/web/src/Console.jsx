import React, { useCallback, useEffect, useRef, useState } from 'react'
import './console.css'

const date = (value) => (value == null ? '—' : new Date(value).toLocaleString())
const duration = (ms) =>
  ms == null ? '—' : ms < 1000 ? ms + ' ms' : Math.round(ms / 100) / 10 + ' s'

function query(path, values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values))
    if (value != null && value !== '') params.set(key, value)
  return path + '?' + params.toString()
}

export function ConsolePanel({ api, mode }) {
  const [jobs, setJobs] = useState([]),
    [runs, setRuns] = useState([]),
    [logs, setLogs] = useState([])
  const [name, setName] = useState(''),
    [runId, setRunId] = useState(''),
    [level, setLevel] = useState(''),
    [source, setSource] = useState('')
  const [tab, setTab] = useState('Jobs'),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false)
  const [follow, setFollow] = useState(true),
    [logBefore, setLogBefore] = useState(null),
    [runBefore, setRunBefore] = useState(null)
  const request = useRef(0),
    timer = useRef(null)
  const refresh = useCallback(async () => {
    const n = ++request.current
    try {
      const [j, r, l] = await Promise.all([
        api('/jobs'),
        api(query('/job-runs', { name, before: runBefore, limit: 40 })),
        api(
          query('/job-logs', {
            name,
            runId,
            level,
            source,
            before: logBefore,
            limit: 60,
          }),
        ),
      ])
      if (n !== request.current) return
      setJobs(j.jobs)
      setRuns(r.runs)
      setLogs(l.logs)
    } catch (error) {
      if (n === request.current) setErr(error.message)
    }
  }, [api, name, runId, level, source, logBefore, runBefore, mode])
  useEffect(() => {
    refresh()
    const receive = (e) => {
      if (e.detail?.mode && e.detail.mode !== mode) return
      if (!follow || timer.current != null) return
      timer.current = setTimeout(() => {
        timer.current = null
        refresh()
      }, 180)
    }
    window.addEventListener('ledger:operations', receive)
    return () => {
      request.current++
      window.removeEventListener('ledger:operations', receive)
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [refresh, mode, follow])
  async function act(job, action) {
    setErr('')
    setBusy(true)
    try {
      await api('/jobs/' + encodeURIComponent(job.name) + '/' + action, {
        method: 'POST',
        body: { runId: job.last?.id },
      })
    } catch (error) {
      setErr(error.message)
    } finally {
      setBusy(false)
      await refresh()
    }
  }
  function filterJob(value) {
    setName(value)
    setRunId('')
    setLogBefore(null)
    setRunBefore(null)
  }
  function inspectRun(row) {
    filterJob(row.name)
    setRunId(row.id)
    setTab('Logs')
  }
  const sources = Array.from(
    new Set([...jobs.map((j) => j.source), ...logs.map((l) => l.source)]),
  ).sort()
  return (
    <section className="ops-console" aria-label="Status and Console">
      <header className="ops-head">
        <div role="group" aria-label="Console view">
          {['Jobs', 'Attempts', 'Logs'].map((t) => (
            <button key={t} aria-pressed={t === tab} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />{' '}
          Follow live
        </label>
        <button
          onClick={() => {
            setErr('')
            refresh()
          }}
        >
          Refresh
        </button>
      </header>
      {err && (
        <p className="ops-error" role="alert">
          {err}{' '}
          <button onClick={() => setErr('')} aria-label="Dismiss error">
            ×
          </button>
        </p>
      )}
      {tab === 'Jobs' ? (
        <div className="ops-job-list">
          {jobs.map((job) => (
            <article key={job.name}>
              <div className="ops-title">
                <strong>{job.description}</strong>
                <span data-state={job.paused ? 'paused' : job.last?.status}>
                  {job.paused ? 'Paused' : (job.last?.status ?? 'Idle')}
                </span>
              </div>
              <small>
                {job.name} · {job.source}
              </small>
              <p>
                Last attempt {date(job.last?.startedAt)} · Last success{' '}
                {date(job.lastSuccess)}
              </p>
              {job.last && (
                <p>
                  {job.last.stage} · {duration(job.last.durationMs)}
                  {job.last.processed != null
                    ? ' · ' +
                      job.last.processed +
                      (job.last.total != null ? ' / ' + job.last.total : '') +
                      ' processed'
                    : ''}
                </p>
              )}
              {job.last?.message && <p>{job.last.message}</p>}
              {job.nextAt != null && <p>Scheduled {date(job.nextAt)}</p>}
              <div className="ops-actions">
                {job.manual && (
                  <button
                    disabled={
                      busy || job.paused || job.last?.status === 'running'
                    }
                    onClick={() => act(job, 'run')}
                  >
                    Run
                  </button>
                )}
                {job.canRetry && (
                  <button
                    disabled={busy || job.paused}
                    onClick={() => act(job, 'retry')}
                  >
                    Retry
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => act(job, job.paused ? 'resume' : 'pause')}
                >
                  {job.paused ? 'Resume' : 'Pause future runs'}
                </button>
                <button
                  onClick={() => {
                    filterJob(job.name)
                    setTab('Attempts')
                  }}
                >
                  History
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <>
          <div className="ops-filters">
            <label>
              Job{' '}
              <select value={name} onChange={(e) => filterJob(e.target.value)}>
                <option value="">All jobs</option>
                {jobs.map((j) => (
                  <option key={j.name}>{j.name}</option>
                ))}
              </select>
            </label>
            {tab === 'Logs' && (
              <>
                <label>
                  Level{' '}
                  <select
                    value={level}
                    onChange={(e) => {
                      setLevel(e.target.value)
                      setLogBefore(null)
                    }}
                  >
                    <option value="">All</option>
                    {['debug', 'info', 'warn', 'error'].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Source{' '}
                  <select
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value)
                      setLogBefore(null)
                    }}
                  >
                    <option value="">All</option>
                    {sources.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                {runId && (
                  <button
                    onClick={() => {
                      setRunId('')
                      setLogBefore(null)
                    }}
                  >
                    Clear attempt filter
                  </button>
                )}
              </>
            )}
          </div>
          {tab === 'Attempts' ? (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Attempt</th>
                    <th>Started</th>
                    <th>Outcome</th>
                    <th>Duration</th>
                    <th>Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <button onClick={() => inspectRun(r)} title={r.id}>
                          {r.name} · {r.id.slice(0, 8)}
                        </button>
                        {r.retryOf && (
                          <small title={r.retryOf}>
                            Retry of {r.retryOf.slice(0, 8)}
                          </small>
                        )}
                      </td>
                      <td>{date(r.startedAt)}</td>
                      <td>{r.status}</td>
                      <td>{duration(r.durationMs)}</td>
                      <td>{r.exitCode ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!runs.length && <p>No attempts in this view.</p>}
              {runs.length === 40 && (
                <button onClick={() => setRunBefore(runs.at(-1).seq)}>
                  Older attempts
                </button>
              )}
              {runBefore != null && (
                <button onClick={() => setRunBefore(null)}>
                  Latest attempts
                </button>
              )}
            </>
          ) : (
            <>
              <ol className="ops-log-list">
                {logs.map((l) => (
                  <li key={l.seq} data-level={l.level}>
                    <small>
                      {date(l.time)} · {l.name} · {l.level}
                    </small>
                    <span>{l.message}</span>
                  </li>
                ))}
              </ol>
              {!logs.length && <p>No matching log entries.</p>}
              {logs.length === 60 && (
                <button onClick={() => setLogBefore(logs.at(-1).seq)}>
                  Older logs
                </button>
              )}
              {logBefore != null && (
                <button onClick={() => setLogBefore(null)}>Latest logs</button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
