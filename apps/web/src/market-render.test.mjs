import test from 'node:test'
import assert from 'node:assert/strict'
import React, { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { createHistoryChart } from './history-chart.mjs'
import { prepareHistory } from './history-data.mjs'
import { useMarketRead } from './market-query.js'

test('ECharts renders method-separated series and unavailable markers to SVG without a browser', () => {
  const hour = 3600000,
    t = Date.UTC(2026, 10, 17, 14, 19)
  const rows = [
    { t, sold: 0, method: 'prior' },
    { t: t + hour, sold: null, method: 'prior' },
    { t: t + 3 * hour, sold: 5, method: 'v2' },
  ]
  const h = prepareHistory(rows, 'sold', { v: 2, since: t + 2 * hour })
  const chart = createHistoryChart(null, h, 'sold', {
    ssr: true,
    width: 540,
    height: 180,
  })
  try {
    const options = chart.getOption()
    assert.deepEqual(
      options.series.filter((s) => s.type === 'line').map((s) => s.data),
      [[[t, 0]], [[t + 3 * hour, 5]]],
    )
    assert.equal(options.series.at(-1).data[0][0], t + hour)
    assert.match(chart.renderToSVGString(), /<svg[\s>]/)
  } finally {
    chart.dispose()
  }
})

test('two mounted panes share one archive fetch and switch house without redisplaying the prior result', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/' })
  const original = new Map()
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    })
  }
  const root = createRoot(document.getElementById('root'))
  const calls = [],
    resolvers = []
  const api = (path, opts) => {
    calls.push({ path, opts })
    return new Promise((resolve) => resolvers.push(resolve))
  }
  function Pane({ region }) {
    const result = useMarketRead(api, '/markets?limit=1', 'live', region, 1)
    return createElement('p', null, result.data?.house || 'Waiting')
  }
  const render = (region) =>
    root.render(
      createElement(
        React.Fragment,
        null,
        createElement(Pane, { region }),
        createElement(Pane, { region }),
      ),
    )
  try {
    await act(async () => render('us'))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].opts.cache, 'no-store')
    await act(async () => {
      resolvers[0]({ house: 'US' })
      await new Promise((r) => setTimeout(r, 10))
    })
    assert.deepEqual(
      [...document.querySelectorAll('p')].map((el) => el.textContent),
      ['US', 'US'],
    )
    await act(async () => render('eu'))
    assert.equal(calls.length, 2)
    assert.deepEqual(
      [...document.querySelectorAll('p')].map((el) => el.textContent),
      ['Waiting', 'Waiting'],
    )
    await act(async () => {
      resolvers[1]({ house: 'EU' })
      await new Promise((r) => setTimeout(r, 10))
    })
    assert.deepEqual(
      [...document.querySelectorAll('p')].map((el) => el.textContent),
      ['EU', 'EU'],
    )
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [key, desc] of original) {
      if (desc) Object.defineProperty(globalThis, key, desc)
      else delete globalThis[key]
    }
  }
})
