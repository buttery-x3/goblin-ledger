import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import React, { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { registerMarket } from '../../local/market.mjs'
import { getRoutes } from '../../local/farms.mjs'
import { listCharacters } from '../../local/personal.mjs'

test('Opportunities opens real item detail from the whole house and preserves independent scanner controls', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  })
  const db = new DatabaseSync(':memory:')
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/' })
  const originals = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    })
  }
  const root = createRoot(document.getElementById('root'))
  try {
    const { Opportunities } = await server.ssrLoadModule('/src/Markets.jsx')
    const views = new Map()
    const profile = { db, mode: 'demo', region: 'us' }
    let selectedRoute
    registerMarket(
      { get: (key, fn) => views.set(key, fn), post() {} },
      { profile: () => profile, jobs: { register() {} } },
    )
    const api = async (path) => {
      const url = new URL('/api/v1' + path, 'http://127.0.0.1/')
      const query = Object.fromEntries(url.searchParams)
      if (url.pathname === '/api/v1/research') return { items: [] }
      if (url.pathname === '/api/v1/personal/characters') return { characters: listCharacters(profile) }
      if (url.pathname === '/api/v1/opportunities')
        return views.get(url.pathname)({ query })
      return views.get('/api/v1/markets/:id')({
        params: { id: url.pathname.split('/').at(-1) },
        query,
      })
    }
    const routes = getRoutes(profile)
    function App() {
      const [pane, setPane] = useState({ action: 'hold', order: 'name' })
      return createElement(Opportunities, {
        api,
        routes,
        onSelectRoute: (id) => { selectedRoute = id },
        mode: 'demo',
        region: 'us',
        pane,
        updatePane: (patch) =>
          setPane((previous) => ({ ...previous, ...patch })),
      })
    }
    const button = (text) =>
      [...document.querySelectorAll('button')].find((b) =>
        b.textContent.trim().includes(text),
      )
    async function waitFor(get) {
      for (let tries = 0; tries < 300; tries++) {
        const value = get()
        if (value) return value
        await act(() => new Promise((r) => setTimeout(r, 10)))
      }
      assert.fail('Expected control or view did not appear.')
    }
    await act(async () => root.render(createElement(App)))
    await waitFor(() =>
      document.querySelector(
        'section[aria-label="Auction house market overview"]',
      ),
    )
    const inspector = button('Linen Cloth')
    assert(inspector)
    const item = inspector.textContent
    await act(async () => inspector.click())
    await waitFor(() => document.querySelector('h3')?.textContent === item)
    await waitFor(() => document.querySelector('[role="img"]'))
    const sources = [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent.includes('Where to farm'))
    assert.ok(sources)
    await act(async () => { sources.open = true })
    await waitFor(() => sources.textContent.includes('Ember') && sources.textContent.includes('Can do now'))
    await act(async () => button('Jangolode Mine').click())
    assert.equal(selectedRoute, 'jangolode-linen')
    await act(async () => button('Results').click())
    await waitFor(() =>
      document.querySelector(
        'section[aria-label="Auction house market overview"]',
      ),
    )
    await act(async () => button('Signal scanner').click())
    await waitFor(() => document.querySelector('details.market-signal'))
    assert.equal(document.querySelector('select').value, 'hold')
    assert.equal(document.querySelectorAll('select')[1].value, 'name')
  } finally {
    await act(async () => root.unmount())
    await server.close()
    db.close()
    dom.window.close()
    for (const [key, value] of originals) {
      if (value) Object.defineProperty(globalThis, key, value)
      else delete globalThis[key]
    }
  }
})
