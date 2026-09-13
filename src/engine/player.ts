// Workout-Player: steuert den Ablauf, sendet ERG-Sollwerte, zeichnet Samples auf.
import { expandSegments, targetPctAt, type Workout } from './model'
import { computeSummary, bestRollingAvg, type Sample } from './metrics'
import { getState, setState, showToast } from '../state'
import { setTargetPower } from '../ble/manager'
import { bridge, type Session } from '../bridge'

let tickTimer: ReturnType<typeof setInterval> | null = null
let lastSentTarget = -1
let lastSentAt = 0

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
      startedAt: new Date().toISOString(), pausedByDisconnect: false,
    },
  })
  lastSentTarget = -1
  lastSentAt = 0
  bridge.keepAwake(true)
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = setInterval(tick, 1000)
}

export function pauseWorkout(byDisconnect = false) {
  setState(st => ({ player: { ...st.player, status: 'paused', pausedByDisconnect: byDisconnect } }))
}

export function resumeWorkout() {
  setState(st => ({ player: { ...st.player, status: 'riding', pausedByDisconnect: false } }))
  lastSentTarget = -1 // Sollwert sofort neu senden
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

  if (done) finishWorkout()
}

export async function finishWorkout() {
  const st = getState()
  const p = st.player
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
  bridge.keepAwake(false)
  setTargetPower(0)

  if (p.samples.length < 10) {
    setState(s => ({ player: { ...s.player, status: 'idle', workout: null, samples: [] } }))
    showToast('Workout verworfen (zu kurz für eine Aufzeichnung).')
    return
  }

  const settings = st.settings!
  const summary = computeSummary(p.samples, settings.ftp, settings.powerZones)
  const session: Session = {
    id: '',
    name: p.workout?.name || 'Workout',
    workoutId: p.workout?.id,
    startedAt: p.startedAt || new Date().toISOString(),
    durationSec: p.samples.length,
    ftpAtTime: settings.ftp,
    summary,
    samples: p.samples,
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
}

export function dismissSummary() {
  setState(s => ({
    lastFinished: null,
    ftpSuggestion: null,
    player: { ...s.player, status: 'idle', workout: null, samples: [], elapsed: 0, trimPct: 0 },
  }))
}
