// Workout-Modell: Segmente in %FTP, zur Laufzeit in Watt umgerechnet.

export type Segment =
  | { type: 'warmup' | 'cooldown' | 'ramp'; sec: number; fromPct: number; toPct: number }
  | { type: 'steady'; sec: number; pct: number }
  | { type: 'intervals'; reps: number; onSec: number; onPct: number; offSec: number; offPct: number }
  | { type: 'freeride'; sec: number }

export interface Workout {
  id: string
  name: string
  description?: string
  tags?: string[]
  kind?: 'normal' | 'ramptest' | 'freeride'
  source?: 'builtin' | 'custom' | 'claude'
  segments: Segment[]
}

// Ein expandierter Schritt: lineare Interpolation von startPct → endPct über [startSec, endSec)
export interface Step {
  startSec: number
  endSec: number
  startPct: number
  endPct: number
  label: string
  freeride?: boolean
}

export function expandSegments(segments: Segment[]): Step[] {
  const steps: Step[] = []
  let t = 0
  for (const seg of segments) {
    if (seg.type === 'steady') {
      steps.push({ startSec: t, endSec: t + seg.sec, startPct: seg.pct, endPct: seg.pct, label: 'Konstant' })
      t += seg.sec
    } else if (seg.type === 'warmup' || seg.type === 'cooldown' || seg.type === 'ramp') {
      const label = seg.type === 'warmup' ? 'Aufwärmen' : seg.type === 'cooldown' ? 'Ausfahren' : 'Rampe'
      steps.push({ startSec: t, endSec: t + seg.sec, startPct: seg.fromPct, endPct: seg.toPct, label })
      t += seg.sec
    } else if (seg.type === 'intervals') {
      for (let i = 1; i <= seg.reps; i++) {
        steps.push({ startSec: t, endSec: t + seg.onSec, startPct: seg.onPct, endPct: seg.onPct, label: `Intervall ${i}/${seg.reps}` })
        t += seg.onSec
        steps.push({ startSec: t, endSec: t + seg.offSec, startPct: seg.offPct, endPct: seg.offPct, label: `Pause ${i}/${seg.reps}` })
        t += seg.offSec
      }
    } else if (seg.type === 'freeride') {
      steps.push({ startSec: t, endSec: t + seg.sec, startPct: 0, endPct: 0, label: 'Freies Fahren', freeride: true })
      t += seg.sec
    }
  }
  return steps
}

export function workoutDuration(w: Workout): number {
  const steps = expandSegments(w.segments)
  return steps.length ? steps[steps.length - 1].endSec : 0
}

export function targetPctAt(steps: Step[], sec: number): { pct: number; step: Step | null } {
  for (const s of steps) {
    if (sec >= s.startSec && sec < s.endSec) {
      const f = (sec - s.startSec) / Math.max(1, s.endSec - s.startSec)
      return { pct: s.startPct + (s.endPct - s.startPct) * f, step: s }
    }
  }
  return { pct: 0, step: null }
}

export interface PowerZone { name: string; pctHigh: number }

export const ZONE_COLORS = ['#6b7f99', '#3b9dd6', '#3ecf8e', '#e8c547', '#f2903a', '#e5484d', '#b264e0']

export function zoneIndex(pct: number, zones: PowerZone[]): number {
  for (let i = 0; i < zones.length; i++) if (pct <= zones[i].pctHigh) return i
  return zones.length - 1
}

export function zoneColor(pct: number, zones: PowerZone[]): string {
  return ZONE_COLORS[Math.min(zoneIndex(pct, zones), ZONE_COLORS.length - 1)]
}

export function fmtDuration(sec: number): string {
  sec = Math.max(0, Math.round(sec))
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
