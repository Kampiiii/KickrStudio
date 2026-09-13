// Leistungs-/HF-/Kadenz-Kurven einer Session mit uPlot.
import { useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { Sample } from '../engine/metrics'
import { fmtDuration } from '../engine/model'

export default function SessionChart({ samples, height = 260 }: { samples: Sample[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!ref.current || samples.length < 2) return
    const t = samples.map(s => s.t)
    const power = samples.map(s => s.power)
    const target = samples.map(s => s.target)
    const hr = samples.map(s => s.hr)
    const cadence = samples.map(s => s.cadence)

    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height,
      cursor: { drag: { x: true, y: false } },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: '#8b98a9', grid: { stroke: '#232e3d' }, ticks: { stroke: '#232e3d' },
          values: (_u, vals) => vals.map(v => fmtDuration(v as number)),
        },
        { stroke: '#8b98a9', grid: { stroke: '#232e3d' }, ticks: { stroke: '#232e3d' } },
      ],
      series: [
        { label: 'Zeit', value: (_u, v) => v == null ? '' : fmtDuration(v as number) },
        { label: 'Ziel (W)', stroke: '#5c6875', width: 1, dash: [4, 4] },
        { label: 'Leistung (W)', stroke: '#3ecf8e', width: 1.5, fill: 'rgba(62,207,142,0.08)' },
        { label: 'HF (bpm)', stroke: '#e5484d', width: 1.2 },
        { label: 'Kadenz (rpm)', stroke: '#3b9dd6', width: 1, show: false },
      ],
      legend: { live: true },
    }
    const plot = new uPlot(opts, [t, target, power, hr, cadence] as uPlot.AlignedData, ref.current)
    plotRef.current = plot

    const onResize = () => {
      if (ref.current) plot.setSize({ width: ref.current.clientWidth, height })
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); plot.destroy(); plotRef.current = null }
  }, [samples, height])

  return <div ref={ref} style={{ width: '100%' }} />
}
