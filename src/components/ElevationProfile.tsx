// Höhenprofil einer Tour als SVG, nach Steigung eingefärbt, mit Markierung der aktuellen Position.
import { useMemo } from 'react'
import type { Tour } from '../engine/tour'

const W = 1000
const MAX_POINTS = 500

export function gradeColor(g: number): string {
  if (g < -2) return '#3b9dd6'   // Gefälle
  if (g < 2) return '#3ecf8e'    // flach
  if (g < 5) return '#e8c547'    // leicht
  if (g < 8) return '#f2903a'    // mittel
  return '#e5484d'               // steil
}

export default function ElevationProfile({ tour, distM, height = 110 }: { tour: Tour; distM?: number; height?: number }) {
  const geo = useMemo(() => {
    const n = tour.alt.length
    const step = Math.max(1, Math.ceil(n / MAX_POINTS))
    const idx: number[] = []
    for (let i = 0; i < n; i += step) idx.push(i)
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1)
    let min = Infinity, max = -Infinity
    for (const i of idx) { min = Math.min(min, tour.alt[i]); max = Math.max(max, tour.alt[i]) }
    const pad = Math.max(10, (max - min) * 0.1)
    min -= pad; max += pad
    const x = (i: number) => (i / (n - 1)) * W
    const y = (a: number) => height - ((a - min) / (max - min)) * (height - 8) - 4
    const area = `M0,${height} ` + idx.map(i => `L${x(i).toFixed(1)},${y(tour.alt[i]).toFixed(1)}`).join(' ') + ` L${W},${height} Z`
    const segs = idx.slice(1).map((i, k) => ({
      d: `M${x(idx[k]).toFixed(1)},${y(tour.alt[idx[k]]).toFixed(1)} L${x(i).toFixed(1)},${y(tour.alt[i]).toFixed(1)}`,
      c: gradeColor(tour.grade[i]),
    }))
    return { area, segs, y, minAlt: min + pad, maxAlt: max - pad }
  }, [tour, height])

  const pos = distM != null ? Math.max(0, Math.min(1, distM / tour.distanceM)) : null
  const posAlt = pos != null ? tour.alt[Math.min(tour.alt.length - 1, Math.round(pos * (tour.alt.length - 1)))] : null

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        <path d={geo.area} fill="rgba(139,152,169,0.12)" />
        {geo.segs.map((s, i) => <path key={i} d={s.d} stroke={s.c} strokeWidth={3} fill="none" vectorEffect="non-scaling-stroke" />)}
        {pos != null && <line x1={pos * W} x2={pos * W} y1={0} y2={height} stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      </svg>
      {pos != null && posAlt != null && (
        <div style={{
          position: 'absolute', left: `calc(${pos * 100}% - 6px)`, top: geo.y(posAlt) - 6, width: 12, height: 12,
          borderRadius: '50%', background: '#fff', border: '2px solid #0b0f14', pointerEvents: 'none',
        }} />
      )}
      <div style={{ position: 'absolute', left: 6, top: 2, fontSize: 11, color: 'var(--text-faint)' }}>{Math.round(geo.maxAlt)} m</div>
      <div style={{ position: 'absolute', left: 6, bottom: 2, fontSize: 11, color: 'var(--text-faint)' }}>{Math.round(geo.minAlt)} m</div>
      <div style={{ position: 'absolute', right: 6, bottom: 2, fontSize: 11, color: 'var(--text-faint)' }}>{(tour.distanceM / 1000).toFixed(1)} km</div>
    </div>
  )
}
