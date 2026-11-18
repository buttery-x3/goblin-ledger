import React, { useEffect, useRef } from 'react'
import { createHistoryChart } from './history-chart.mjs'
import { metrics } from './history-data.mjs'
export default function HistoryPlot({ history, metric }) {
  const element = useRef(null)
  useEffect(() => {
    const node = element.current
    let chart
    function draw() {
      if (!node.clientWidth || !node.clientHeight) return
      if (!chart) {
        chart = createHistoryChart(node, history, metric)
      } else chart.resize()
    }
    draw()
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw)
    observer?.observe(node)
    window.addEventListener('resize', draw)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', draw)
      chart?.dispose()
    }
  }, [history, metric])
  return (
    <div
      ref={element}
      role="img"
      aria-label={
        metrics[metric].name +
        ' by local time. Exact values and missing observations follow in the table.'
      }
      style={{ height: '170px', width: '100%', minWidth: 0 }}
    />
  )
}
