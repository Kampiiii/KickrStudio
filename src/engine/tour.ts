// Touren-Replay: Aus einer früher gefahrenen Outdoor-Fahrt (GPS + Höhe aus den Strava-Sekundenwerten)
// wird eine Strecke mit Steigungsprofil. Der Trainer simuliert die Steigung, die Geschwindigkeit
// ergibt sich aus deiner Leistung (Physikmodell), der Punkt auf der Karte folgt entsprechend.
import type { Session } from '../bridge'

// Strecke in festen Abständen (stepM) abgetastet; alle Arrays sind gleich lang.
export interface Tour {
  sessionId: string
  name: string
  startedAt: string
  stepM: number
  distanceM: number
  lat: number[]
  lng: number[]
  alt: number[]
  grade: number[] // Steigung in % (geglättet, begrenzt)
  ascentM: number
  hasElevation: boolean
}

export const TOUR_STEP_M = 20
// Grenzen der Steigung, die an den Trainer gesendet wird. Die tatsächlichen Grenzen des Kickr
// sind nicht bestätigt; der Trainer begrenzt ggf. selbst.
export const GRADE_MIN = -10
export const GRADE_MAX = 20

type Sample = NonNullable<Session['samples']>[number]

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}

// Gleitender Mittelwert (Fenster = 2*half+1), Ränder werden verkürzt statt verfälscht
function smooth(a: number[], half: number): number[] {
  return a.map((_, i) => {
    let s = 0, n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(a.length - 1, i + half); j++) { s += a[j]; n++ }
    return s / n
  })
}

export function buildTour(session: Session): Tour | null {
  const raw = (session.samples || []).filter((s): s is Sample & { lat: number; lng: number } => s.lat != null && s.lng != null)
  if (raw.length < 20) return null

  // Kumulierte Strecke über GPS (stehende Punkte überspringen)
  const D: number[] = [0], LAT = [raw[0].lat], LNG = [raw[0].lng]
  let lastAlt = raw.find(s => s.altitudeM != null)?.altitudeM ?? 0
  const ALT = [raw[0].altitudeM ?? lastAlt]
  let anyAlt = raw.some(s => s.altitudeM != null)
  for (let i = 1; i < raw.length; i++) {
    const d = haversineM(LAT[LAT.length - 1], LNG[LNG.length - 1], raw[i].lat, raw[i].lng)
    if (d < 0.5) continue
    D.push(D[D.length - 1] + d)
    LAT.push(raw[i].lat); LNG.push(raw[i].lng)
    lastAlt = raw[i].altitudeM ?? lastAlt
    ALT.push(lastAlt)
  }
  const total = D[D.length - 1]
  if (total < 500) return null

  // Gleichmäßig neu abtasten
  const n = Math.floor(total / TOUR_STEP_M) + 1
  const lat: number[] = [], lng: number[] = [], altRaw: number[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const d = k * TOUR_STEP_M
    while (j < D.length - 2 && D[j + 1] < d) j++
    const span = D[j + 1] - D[j]
    const f = span > 0 ? Math.min(1, Math.max(0, (d - D[j]) / span)) : 0
    lat.push(LAT[j] + (LAT[j + 1] - LAT[j]) * f)
    lng.push(LNG[j] + (LNG[j + 1] - LNG[j]) * f)
    altRaw.push(ALT[j] + (ALT[j + 1] - ALT[j]) * f)
  }

  // Höhe ist verrauscht (Barometer/GPS) → zweimal glätten, sonst ruckelt der Widerstand
  const alt = smooth(smooth(altRaw, 2), 2)
  const gradeRaw = alt.map((_, k) => {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1)
    return ((alt[b] - alt[a]) / ((b - a) * TOUR_STEP_M)) * 100
  })
  const grade = smooth(gradeRaw, 1).map(g => Math.max(GRADE_MIN, Math.min(GRADE_MAX, anyAlt ? g : 0)))

  let ascent = 0
  for (let k = 1; k < n; k++) if (alt[k] > alt[k - 1]) ascent += alt[k] - alt[k - 1]

  return {
    sessionId: session.id, name: session.name, startedAt: session.startedAt,
    stepM: TOUR_STEP_M, distanceM: (n - 1) * TOUR_STEP_M, lat, lng, alt, grade,
    ascentM: Math.round(ascent), hasElevation: anyAlt,
  }
}

function interp(arr: number[], tour: Tour, distM: number): number {
  const x = Math.max(0, Math.min(arr.length - 1, distM / tour.stepM))
  const i = Math.floor(x), f = x - i
  return i >= arr.length - 1 ? arr[arr.length - 1] : arr[i] + (arr[i + 1] - arr[i]) * f
}

export const gradeAt = (t: Tour, d: number) => interp(t.grade, t, d)
export const altAt = (t: Tour, d: number) => interp(t.alt, t, d)
export const posAt = (t: Tour, d: number) => ({ lat: interp(t.lat, t, d), lng: interp(t.lng, t, d) })

// ---------- Physik ----------
// Standardwerte für ein Rennrad in aufrechter bis sportlicher Haltung. Dieselben Werte gehen als
// Roll- und Luftwiderstand an den Trainer, damit sich Widerstand und berechnete Geschwindigkeit decken.
export const RIDER = { crr: 0.004, cda: 0.32, rho: 1.226, drivetrain: 0.975, g: 9.80665, bikeKg: 8 }

// Wind-Widerstandskoeffizient für FTMS (kg/m) = 0,5 * rho * CdA
export const windResistanceCoeff = () => 0.5 * RIDER.rho * RIDER.cda

// Geschwindigkeit nach dt Sekunden bei Leistung P (W) und Steigung (%). Mit Trägheit, damit
// Gefälle und Anstiege nicht schlagartig wirken (Schwung wird mitgenommen).
export function nextSpeed(v: number, powerW: number, gradePct: number, massKg: number, dt: number): number {
  const theta = Math.atan(gradePct / 100)
  const sub = 4, h = dt / sub
  let speed = v
  for (let i = 0; i < sub; i++) {
    const drive = (Math.max(0, powerW) * RIDER.drivetrain) / Math.max(speed, 1.5)
    const roll = RIDER.crr * massKg * RIDER.g * Math.cos(theta)
    const grav = massKg * RIDER.g * Math.sin(theta)
    const air = 0.5 * RIDER.rho * RIDER.cda * speed * Math.abs(speed)
    const a = (drive - roll - grav - air) / (massKg + 1.2) // +1,2 kg ≈ Trägheit der Laufräder
    speed = Math.max(0, Math.min(22, speed + a * h)) // 22 m/s ≈ 79 km/h
  }
  return speed
}

// Grobe Fahrzeit bei konstanter Leistung (für die Vorschau in der Tourenliste)
export function estimateDurationSec(tour: Tour, powerW: number, massKg: number, difficulty: number): number {
  let d = 0, v = 4, t = 0
  while (d < tour.distanceM && t < 6 * 3600) {
    const nv = nextSpeed(v, powerW, gradeAt(tour, d) * difficulty, massKg, 1)
    d += (v + nv) / 2
    v = nv
    t++
  }
  return t
}

export interface TourRide {
  tour: Tour
  mode: 'sim' | 'erg'
  difficulty: number // 0..1, Anteil der echten Steigung, der am Trainer ankommt
  ergTarget: number
  distM: number
  speedMs: number
  gradeReal: number
  gradeEff: number
  altNow: number
  ascentDoneM: number
  follow: boolean
}
