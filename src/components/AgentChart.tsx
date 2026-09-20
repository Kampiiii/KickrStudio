// Zeichnet ein vom Coach-Agenten erzeugtes Diagramm (create_chart) mit uPlot.
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { ChartSpec } from '../bridge'
import { fmtDuration } from '../engine/model'

const COLORS = ['#3ecf8e', '#e5484d', '#3b9dd6', '#f2903a']
const HEIGHT = 260

export default function AgentChart({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || spec.x.length === 0) return

    const category = spec.xType === 'category'
    const bars = spec.kind === 'bar' || category
    const labels = category ? spec.x.map(String) : []
    const xs = category ? spec.x.map((_, i) => i) : (spec.x as number[])
    const secondsAxis = !category && spec.xType === 'number' && /sec/i.test(spec.xLabel || '')

    // Reihen mit sehr anderem Wertebereich (z.B. Watt und Herzfrequenz) bekommen eine zweite y-Achse rechts
    const maxAbs = spec.series.map(s => Math.max(1e-9, ...s.values.map(v => Math.abs(v ?? 0))))
    const scaleOf = (i: number) => (i === 0 || (maxAbs[i] / maxAbs[0] <= 2.5 && maxAbs[0] / maxAbs[i] <= 2.5) ? 'y' : 'y2')
    const usesY2 = spec.series.some((_, i) => scaleOf(i) === 'y2')

    const axis = { stroke: '#8b98a9', grid: { stroke: '#232e3d' }, ticks: { stroke: '#232e3d' } }
    const step = Math.max(1, Math.ceil(xs.length / 10))

    const opts: uPlot.Options = {
      width: el.clientWidth || 600,
      height: HEIGHT,
      scales: {
        x: category
          ? { time: false, range: (_u, min, max) => [min - 0.5, max + 0.5] }
          : { time: spec.xType === 'time' },
      },
      axes: [
        {
          ...axis,
          ...(category ? { splits: () => xs.filter((_, i) => i % step === 0), values: (_u: uPlot, vals: number[]) => vals.map(v => labels[v] ?? '') } : {}),
          ...(secondsAxis ? { values: (_u: uPlot, vals: number[]) => vals.map(v => fmtDuration(v)) } : {}),
        },
        { ...axis, scale: 'y' },
        ...(usesY2 ? [{ ...axis, scale: 'y2', side: 1 as const, grid: { show: false } }] : []),
      ],
      series: [
        category ? { value: (_u: uPlot, v: number | null) => (v == null ? '' : labels[v] ?? '') } : secondsAxis ? { value: (_u: uPlot, v: number | null) => (v == null ? '' : fmtDuration(v)) } : {},
        ...spec.series.map((s, i) => ({
          label: s.name,
          scale: scaleOf(i),
          stroke: COLORS[i % COLORS.length],
          width: 1.6,
          spanGaps: true,
          ...(bars ? { fill: COLORS[i % COLORS.length] + '99', paths: uPlot.paths.bars!({ size: [0.6, 100] }) } : {}),
          points: { show: bars || spec.x.length < 60 },
        })),
      ],
      legend: { live: true },
    }

    const data = [xs, ...spec.series.map(s => s.values)] as uPlot.AlignedData
    const plot = new uPlot(opts, data, el)
    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: HEIGHT }))
    ro.observe(el)
    return () => { ro.disconnect(); plot.destroy() }
  }, [spec])

  return (
    <div className="agent-chart">
      <div className="agent-chart-title">{spec.title}</div>
      <div ref={ref} style={{ width: '100%' }} />
    </div>
  )
}
