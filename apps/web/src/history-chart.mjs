import { init, use } from 'echarts/core'
import { LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
} from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { metrics } from './history-data.mjs'

use([
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  LineChart,
  ScatterChart,
  SVGRenderer,
])

const labels = { color: '#acb9b0', fontSize: 10 }
const clock = (t) =>
  new Date(t).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
const colors = ['#dfbf7b', '#83bfac', '#b39bd1']
function option(history, metric) {
  const { rows, segments, missing, gaps, boundaries } = history
  const spec = metrics[metric]
  const min = rows[0].t,
    max = rows.at(-1).t
  const names = [...new Set(segments.map((s) => s.method))]
  const values = segments.map((s) => ({
    name: s.method ? spec.name + ' · ' + s.method : spec.name,
    type: 'line',
    data: s.points,
    symbolSize: 5,
    showSymbol: true,
    connectNulls: false,
    itemStyle: { color: colors[names.indexOf(s.method) % colors.length] },
    tooltip: {
      valueFormatter: (value) =>
        value == null
          ? 'Unavailable'
          : Number(value).toLocaleString() + ' ' + spec.unit,
    },
  }))
  return {
    animation: false,
    backgroundColor: 'transparent',
    grid: { left: 65, right: 15, top: 22, bottom: 34 },
    xAxis: {
      type: 'time',
      min: min === max ? min - 1800000 : min,
      max: min === max ? max + 1800000 : max,
      axisLabel: { ...labels, hideOverlap: true },
      axisLine: { lineStyle: { color: '#43534d' } },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        minInterval: 1,
        axisLabel: labels,
        splitLine: { lineStyle: { color: '#354640', type: 'dashed' } },
      },
      { type: 'value', min: 0, max: 1, show: false },
    ],
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      confine: true,
      formatter: (p) =>
        p.seriesId === 'unavailable'
          ? clock(p.value[0]) + ' · unavailable'
          : Array.isArray(p.value)
            ? clock(p.value[0]) +
              '\n' +
              p.seriesName +
              ' · ' +
              p.value[1].toLocaleString() +
              ' ' +
              spec.unit
            : p.name,
    },
    series: [
      ...values,
      {
        id: 'unavailable',
        name: 'Unavailable observation',
        type: 'scatter',
        yAxisIndex: 1,
        symbol: 'diamond',
        symbolSize: 7,
        data: missing.map((t) => [t, 0.025]),
        itemStyle: { color: '#a9a7a1' },
        markArea: {
          silent: true,
          itemStyle: { color: 'rgba(175,182,175,0.09)' },
          data: [
            ...gaps.map((g) => [{ xAxis: g.from }, { xAxis: g.to }]),
            ...history.researchDays.map((d) => [
              { xAxis: d.from, yAxis: 0.92, itemStyle: { color: '#77ad9e' } },
              { xAxis: d.to, yAxis: 1 },
            ]),
          ],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: '#b39bd1' },
          label: { show: false },
          data: boundaries.map((t) => ({ xAxis: t })),
        },
      },
    ],
  }
}

export function createHistoryChart(node, history, metric, options = {}) {
  const chart = init(node, null, { ...options, renderer: 'svg' })
  chart.setOption(option(history, metric))
  return chart
}
