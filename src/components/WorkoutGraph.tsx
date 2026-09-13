// Workout-Profil als SVG: Segmentflächen farbcodiert nach Zone, optional
// Fortschritts-Cursor und Ist-Leistungskurve während der Fahrt.
import { useMemo } from 'react'
import type { Step, PowerZone } from '../engine/model'
import { zoneColor } from '../engine/model'
import type { Sample } from '../engine/metrics'

interface Props {
  steps: Step[]
  zones: PowerZone[]
  elapsed?: number
  samples?: Sample[]
  ftp?: number
  height?: number
}

export default function WorkoutGraph({ steps, zones, elapsed, samples, ftp, height = 140 }: Props) {
  const total = steps.length ? steps[steps.length - 1].endSec : 1
  const maxPct = Math.max(130, ...steps.map(s => Math.max(s.startPct, s.endPct))) * 1.1
  const W = 1000, H = 300

  const polys = useMemo(() => steps.map((s, i) => {
    const x1 = (s.startSec / total) * W
    const x2 = (s.endSec / total) * W
    const pct = Math.max(s.startPct, s.endPct)
    const y1 = H - (s.startPct / maxPct) * H
    const y2 = H - (s.endPct / maxPct) * H
    const color = s.freeride ? '#4a5a6d' : zoneColor(pct, zones)
    return { key: i, points: `${x1},${H} ${x1},${y1} ${x2},${y2} ${x2},${H}`, color }
  }), [steps, total, maxPct, zones])

  // Ist-Leistung als Linie (auf %FTP normiert), auf max. 500 Punkte reduziert
  const powerPath = useMemo(() => {
    if (!samples || !ftp || samples.length < 2) return null
    const stride = Math.max(1, Math.floor(samples.length / 500))
    const pts: string[] = []
    for (let i = 0; i < samples.length; i += stride) {
      const s = samples[i]
      const x = (s.t / total) * W
      const y = H - Math.min(H, ((s.power / ftp) * 100 / maxPct) * H)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [samples, ftp, total, maxPct])

  const cursorX = elapsed != null ? (Math.min(elapsed, total) / total) * W : null
  const ftpY = H - (100 / maxPct) * H

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', borderRadius: 8, background: 'var(--bg-raised)' }}>
      {polys.map(p => <polygon key={p.key} points={p.points} fill={p.color} opacity={0.82} />)}
      <line x1={0} y1={ftpY} x2={W} y2={ftpY} stroke="#ffffff" strokeOpacity={0.25} strokeDasharray="6 5" strokeWidth={1.5} />
      {powerPath && <polyline points={powerPath} fill="none" stroke="#ffffff" strokeOpacity={0.85} strokeWidth={2} />}
      {cursorX != null && (
        <g>
          <rect x={0} y={0} width={cursorX} height={H} fill="#000" opacity={0.28} />
          <line x1={cursorX} y1={0} x2={cursorX} y2={H} stroke="var(--accent)" strokeWidth={2.5} />
        </g>
      )}
    </svg>
  )
}
