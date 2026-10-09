// Workout-Player: steuert den Ablauf, sendet ERG-Sollwerte, zeichnet Samples auf.
import { expandSegments, targetPctAt, type Workout } from './model'
import { computeSummary, bestRollingAvg, type Sample } from './metrics'
import { getState, setState, showToast } from '../state'
import { setTargetPower, setSimulation } from '../ble/manager'
import { bridge, type Session } from '../bridge'
import { runCloudSync } from './cloudSync'
import { gradeAt, altAt, posAt, nextSpeed, RIDER, windResistanceCoeff, type Tour, type TourRide } from './tour'

let tickTimer: ReturnType<typeof setInterval> | null = null
let lastSentTarget = -1
let lastSentAt = 0
let lastSentGrade = Number.NaN // zuletzt an den Trainer gesendete Steigung (Tour, Simulationsmodus)
const DRAFT_SAVE_INTERVAL_SEC = 15

export function startWorkout(workout: Workout) {
  const st = getState()
  if (st.player.status === 'riding' || st.player.status === 'paused') {
    showToast('Es läuft bereits ein Workout.', 'err')
    return
  }
  const steps = expandSegments(workout.segments)
  setState({
    page: 'train',
    selectedWorkout: workout,
    lastFinished: null,
    ftpSuggestion: null,
    player: {
      status: 'riding', workout, steps, elapsed: 0, trimPct: 0,
      freerideTarget: 120, currentTarget: 0, samples: [],
      startedAt: new Date().toISOString(), pausedByDisconnect: false, tour: null,
    },
  })
  lastSentTarget = -1
  lastSentAt = 0
  bridge.keepAwake(true)
  bridge.notifyPlayerStatus('riding')
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(tick, 1000)
}

export function pauseWorkout(byDisconnect = false) {
  setState(st => ({ player: { ...st.player, status: 'paused', pausedByDisconnect: byDisconnect } }))
  bridge.notifyPlayerStatus('paused')
}

export function resumeWorkout() {
  setState(st => ({ player: { ...st.player, status: 'riding', pausedByDisconnect: false } }))
  bridge.notifyPlayerStatus('riding')
  lastSentTarget = -1 // Sollwert sofort neu senden
  lastSentGrade = Number.NaN
}

export function skipSegment() {
  const st = getState()
  const { steps, elapsed } = st.player
  const cur = steps.find(s => elapsed >= s.startSec && elapsed < s.endSec)
  if (cur) setState(s => ({ player: { ...s.player, elapsed: cur.endSec } }))
}

export function trim(deltaPct: number) {
  setState(st => ({ player: { ...st.player, trimPct: Math.max(-30, Math.min(30, st.player.trimPct + deltaPct)) } }))
  lastSentTarget = -1
}

export function setFreerideTarget(watts: number) {
  setState(st => ({ player: { ...st.player, freerideTarget: Math.max(0, Math.min(1000, Math.round(watts))) } }))
  lastSentTarget = -1
}

function tick() {
  const st = getState()
  const p = st.player
  if (p.status !== 'riding' && p.status !== 'paused') return

  // Trainer weg → automatisch pausieren; wieder da → weiterfahren
  if (p.status === 'riding' && st.trainerState !== 'connected' && st.trainerState !== 'disconnected') {
    pauseWorkout(true)
    return
  }
  if (p.status === 'paused' && p.pausedByDisconnect && st.trainerState === 'connected') {
    resumeWorkout()
    return
  }
  if (p.status !== 'riding') return
  if (p.tour) { tickTour(st); return }

  const settings = st.settings
  const ftp = settings?.ftp || 200
  const { pct, step } = targetPctAt(p.steps, p.elapsed)
  const isFreeride = step?.freeride || p.workout?.kind === 'freeride'
  const targetW = isFreeride
    ? p.freerideTarget
    : Math.round((pct / 100) * ftp * (1 + p.trimPct / 100))

  // ERG-Sollwert bei Änderung und periodisch (gegen verpasste Writes) senden
  const resendMs = (settings?.erg.resendIntervalSec || 10) * 1000
  if (targetW !== lastSentTarget || Date.now() - lastSentAt > resendMs) {
    lastSentTarget = targetW
    lastSentAt = Date.now()
    setTargetPower(targetW)
  }

  const sample: Sample = {
    t: p.samples.length,
    power: st.telemetry.power ?? 0,
    hr: st.telemetry.hr,
    cadence: st.telemetry.cadence,
    target: targetW,
  }
  const elapsed = p.elapsed + 1
  const done = p.steps.length > 0 && elapsed >= p.steps[p.steps.length - 1].endSec

  setState(s => ({
    player: { ...s.player, elapsed, currentTarget: targetW, samples: [...s.player.samples, sample] },
  }))

  // Zwischenstand sichern — falls die App unerwartet schließt/abstürzt, geht die
  // Aufzeichnung dann nicht komplett verloren (Wiederherstellung beim nächsten Start).
  if (elapsed > 0 && elapsed % DRAFT_SAVE_INTERVAL_SEC === 0) {
    const st2 = getState()
    bridge.saveDraftSession({
      name: p.workout?.name || 'Workout',
      workoutId: p.workout?.id,
      startedAt: p.startedAt || new Date().toISOString(),
      ftpAtTime: st2.settings?.ftp || 200,
      samples: st2.player.samples,
    })
  }

  if (done) finishWorkout()
}

// ---------- Touren-Replay ----------

export function startTour(tour: Tour, opts: { mode: 'sim' | 'erg'; difficulty: number; ergTarget?: number }) {
  const st = getState()
  if (st.player.status === 'riding' || st.player.status === 'paused') {
    showToast('Es läuft bereits eine Einheit.', 'err')
    return
  }
  const ride: TourRide = {
    tour, mode: opts.mode, difficulty: opts.difficulty,
    ergTarget: opts.ergTarget ?? Math.round((st.settings?.ftp || 200) * 0.6),
    distM: 0, speedMs: 0, gradeReal: gradeAt(tour, 0), gradeEff: 0,
    altNow: altAt(tour, 0), ascentDoneM: 0, follow: false,
  }
  setState({
    page: 'train',
    selectedWorkout: null,
    lastFinished: null,
    ftpSuggestion: null,
    player: {
      status: 'riding', workout: null, steps: [], elapsed: 0, trimPct: 0,
      freerideTarget: 120, currentTarget: 0, samples: [],
      startedAt: new Date().toISOString(), pausedByDisconnect: false, tour: ride,
    },
  })
  lastSentTarget = -1
  lastSentAt = 0
  lastSentGrade = Number.NaN
  bridge.keepAwake(true)
  bridge.notifyPlayerStatus('riding')
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(tick, 1000)
}

function patchTour(patch: Partial<TourRide>) {
  setState(st => st.player.tour ? { player: { ...st.player, tour: { ...st.player.tour, ...patch } } } : {})
}

export function setTourMode(mode: 'sim' | 'erg') {
  patchTour({ mode })
  lastSentTarget = -1
  lastSentGrade = Number.NaN // beim Wechsel sofort neu an den Trainer senden
}

export function setTourDifficulty(difficulty: number) {
  patchTour({ difficulty: Math.max(0, Math.min(1, difficulty)) })
  lastSentGrade = Number.NaN
}

export function setTourErgTarget(watts: number) {
  patchTour({ ergTarget: Math.max(50, Math.min(1000, Math.round(watts))) })
  lastSentTarget = -1
}

export function setTourFollow(follow: boolean) {
  patchTour({ follow })
}

function tickTour(st: ReturnType<typeof getState>) {
  const p = st.player
  const tr = p.tour!
  const tour = tr.tour
  const settings = st.settings!
  const mass = (settings.weightKg || 78) + RIDER.bikeKg
  const power = st.telemetry.power ?? 0
  const resendMs = (settings.erg.resendIntervalSec || 10) * 1000

  const gradeReal = gradeAt(tour, tr.distM)
  const gradeEff = gradeReal * tr.difficulty
  const now = Date.now()

  if (tr.mode === 'sim') {
    // Steigung bei spürbarer Änderung (>0,2 %) und regelmäßig (gegen verpasste Writes) senden
    if (Number.isNaN(lastSentGrade) || Math.abs(gradeEff - lastSentGrade) >= 0.2 || now - lastSentAt > resendMs) {
      lastSentGrade = gradeEff
      lastSentAt = now
      setSimulation(gradeEff, RIDER.crr, windResistanceCoeff())
    }
  } else if (tr.ergTarget !== lastSentTarget || now - lastSentAt > resendMs) {
    lastSentTarget = tr.ergTarget
    lastSentAt = now
    setTargetPower(tr.ergTarget)
  }

  // Geschwindigkeit aus deiner Leistung, Strecke aus der Geschwindigkeit
  const v = nextSpeed(tr.speedMs, power, gradeEff, mass, 1)
  const dist = Math.min(tour.distanceM, tr.distM + (tr.speedMs + v) / 2)
  const pos = posAt(tour, dist)
  const alt = altAt(tour, dist)
  const ascentDoneM = tr.ascentDoneM + Math.max(0, alt - tr.altNow)

  const sample: Sample = {
    t: p.samples.length,
    power,
    hr: st.telemetry.hr,
    cadence: st.telemetry.cadence,
    target: tr.mode === 'erg' ? tr.ergTarget : 0,
    lat: Math.round(pos.lat * 1e5) / 1e5,
    lng: Math.round(pos.lng * 1e5) / 1e5,
    altitudeM: Math.round(alt * 10) / 10,
    distanceM: Math.round(dist * 10) / 10,
    gradePct: Math.round(gradeEff * 10) / 10,
    speedKmh: Math.round(v * 3.6 * 10) / 10,
  }
  const elapsed = p.elapsed + 1
  const done = dist >= tour.distanceM - 1

  setState(s => ({
    player: {
      ...s.player, elapsed, currentTarget: tr.mode === 'erg' ? tr.ergTarget : 0,
      samples: [...s.player.samples, sample],
      tour: s.player.tour ? { ...s.player.tour, distM: dist, speedMs: v, gradeReal, gradeEff, altNow: alt, ascentDoneM } : null,
    },
  }))

  if (elapsed > 0 && elapsed % DRAFT_SAVE_INTERVAL_SEC === 0) {
    const st2 = getState()
    bridge.saveDraftSession({
      name: `Tour: ${tour.name}`,
      startedAt: p.startedAt || new Date().toISOString(),
      ftpAtTime: st2.settings?.ftp || 200,
      samples: st2.player.samples,
    })
  }

  if (done) finishWorkout()
}

export async function finishWorkout() {
  const st = getState()
  const p = st.player
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  bridge.keepAwake(false)
  bridge.notifyPlayerStatus('idle')
  bridge.clearDraftSession()
  // Tour im Simulationsmodus: Trainer wieder auf flach, sonst bleibt die letzte Steigung hängen
  if (p.tour?.mode === 'sim') setSimulation(0, RIDER.crr, windResistanceCoeff())
  else setTargetPower(0)

  if (p.samples.length < 10) {
    setState(s => ({ player: { ...s.player, status: 'idle', workout: null, samples: [], tour: null } }))
    showToast('Workout verworfen (zu kurz für eine Aufzeichnung).')
    return
  }

  const settings = st.settings!
  const summary = computeSummary(p.samples, settings.ftp, settings.powerZones)
  const tr = p.tour
  const session: Session = {
    id: '',
    name: tr ? `Tour: ${tr.tour.name}` : (p.workout?.name || 'Workout'),
    workoutId: p.workout?.id,
    startedAt: p.startedAt || new Date().toISOString(),
    durationSec: p.samples.length,
    ftpAtTime: settings.ftp,
    summary,
    samples: p.samples,
    ...(tr ? {
      sport: 'bike' as const,
      distanceM: Math.round(tr.distM),
      elevationGainM: Math.round(tr.ascentDoneM),
      replayOf: { sessionId: tr.tour.sessionId, name: tr.tour.name },
      tourDifficulty: tr.difficulty,
      rideMode: tr.mode,
    } : {}),
  }
  const saved = await bridge.saveSession(session)

  // Rampentest: FTP-Schätzung = 75 % der besten Minutenleistung
  let ftpSuggestion: number | null = null
  if (p.workout?.kind === 'ramptest') {
    ftpSuggestion = Math.round(bestRollingAvg(p.samples, 60) * 0.75)
  }

  const sessions = await bridge.listSessions()
  setState(s => ({
    sessions,
    lastFinished: saved,
    ftpSuggestion,
    player: { ...s.player, status: 'finished' },
  }))

  if (settings.cloud?.autoSync) void runCloudSync()
}

export function dismissSummary() {
  setState(s => ({
    lastFinished: null,
    ftpSuggestion: null,
    player: { ...s.player, status: 'idle', workout: null, samples: [], elapsed: 0, trimPct: 0, tour: null },
  }))
}
