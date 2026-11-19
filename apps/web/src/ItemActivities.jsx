import React, { useEffect, useState } from 'react'
import { activityAccess } from '../../../packages/domain/character-activities.mjs'

export function ItemActivities({ itemId, routes, onSelectRoute, api, mode, region, refresh }) {
  const [expanded, setExpanded] = useState(false)
  const sites = routes.filter(route => route.outputId === itemId)
  const [roster, setRoster] = useState(null)
  const profile = JSON.stringify([mode, region, refresh])
  const readRoster = expanded && sites.length > 0
  useEffect(() => {
    if (!readRoster) return
    const request = new AbortController()
    api('/personal/characters', { signal: request.signal }).then(data => {
      if (!request.signal.aborted) setRoster({ profile, data })
    }).catch(error => {
      if (!request.signal.aborted) setRoster({ profile, error: error.message })
    })
    return () => request.abort()
  }, [api, readRoster, profile])
  const actors = roster?.profile === profile ? roster : { loading: true }
  if (!sites.length) return null

  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Where to farm this item · {sites.length} {sites.length === 1 ? 'route' : 'routes'}</summary>
    {expanded && <>
      {actors.loading && <p>Reading character requirements…</p>}
      {actors.error && <p role="alert">{actors.error}</p>}
      {sites.map(site => <section key={site.id}>
        <h4><button className="market-link" onClick={() => onSelectRoute(site.id)}>{site.name}</button> · {site.zone}</h4>
        {actors.data?.characters.length ? <ul>{actors.data.characters.map(actor => {
          const access = activityAccess(site, actor)
          const label = { available: 'Can do now', unlock: 'Could unlock', check: 'Check access' }[access.state]
          return <li key={actor.id}><strong>{actor.name}</strong> · {label}. {access.reason}</li>
        })}</ul> : <p>{site.requirements}</p>}
      </section>)}
    </>}
  </details>
}
