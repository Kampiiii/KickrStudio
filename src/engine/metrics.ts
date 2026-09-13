import type { PowerZone } from './model'
import { zoneIndex } from './model'

export interface Sample { t: number; power: number; hr: number | null; cadence: number | null; target: number }

export interface Summary {
  avgPower: number; maxPower: number
  np: number; if: number; tss: number; kj: number
  avgHr: number | null; maxHr: number | null
  avgCadence: number | null
  zoneSeconds: number[]
  best60s: number
}

// Normalized Power: 30s-Rollmittel, hoch 4, Mittelwert, 4. Wurzel
export function normalizedPower(samples: Sample[]): number {
  if (samples.length < 30) return avg(samples.map(s => s.power))
  let sum = 0, windowSum = 0
  const window: number[] = []
  let count = 0
  for (const s of samples) {
    window.push(s.power)
    windowSum += s.power
    if (window.length > 30) windowSum -= window.shift()!
    if (window.length === 30) { sum += Math.pow(windowSum / 30, 4); count++ }
  }
  return count ? Math.pow(sum / count, 0.25) : 0
}

function avg(a: number[]): number { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0 }

export function bestRollingAvg(samples: Sample[], windowSec: number): number {
  if (samples.length < windowSec) return avg(samples.map(s => s.power))
  let best = 0, sum = 0
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i].power
    if (i >= windowSec) sum -= samples[i - windowSec].power
    if (i >= windowSec - 1) best = Math.max(best, sum / windowSec)
  }
  return best
}

export function computeSummary(samples: Sample[], ftp: number, zones: PowerZone[]): Summary {
  const powers = samples.map(s => s.power)
  const hrs = samples.map(s => s.hr).filter((h): h is number => h != null && h > 0)
  const cads = samples.map(s => s.cadence).filter((c): c is number => c != null && c > 0)
  const np = normalizedPower(samples)
  const intensity = ftp > 0 ? np / ftp : 0
  const durSec = samples.length
  const tss = ftp > 0 ? (durSec * np * intensity) / (ftp * 3600) * 100 : 0
  const zoneSeconds = zones.map(() => 0)
  for (const s of samples) {
    const pct = ftp > 0 ? (s.power / ftp) * 100 : 0
    zoneSeconds[Math.min(zoneIndex(pct, zones), zoneSeconds.length - 1)]++
  }
  return {
    avgPower: Math.round(avg(powers)),
    maxPower: powers.length ? Math.max(...powers) : 0,
    np: Math.round(np),
    if: Math.round(intensity * 100) / 100,
    tss: Math.round(tss * 10) / 10,
    kj: Math.round(powers.reduce((a, p) => a + p, 0) / 1000),
    avgHr: hrs.length ? Math.round(avg(hrs)) : null,
    maxHr: hrs.length ? Math.max(...hrs) : null,
    avgCadence: cads.length ? Math.round(avg(cads)) : null,
    zoneSeconds,
    best60s: Math.round(bestRollingAvg(samples, 60)),
  }
}
