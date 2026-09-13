import { useEffect, useMemo, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge } from '../bridge'
import { connectTrainer, connectHr, disconnectTrainer, disconnectHr } from '../ble/manager'
import { startWorkout, pauseWorkout, resumeWorkout, skipSegment, trim, finishWorkout, dismissSummary, setFreerideTarget } from '../engine/player'
import { expandSegments, fmtDuration, targetPctAt, zoneColor, workoutDuration } from '../engine/model'
import { computeSummary } from '../engine/metrics'
import WorkoutGraph from '../components/WorkoutGraph'
import SummaryView from '../components/SummaryView'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function smoothPower(samples: { power: number }[], current: number | null, windowSec: number): number | null {
  if (current == null) return null
  const vals = samples.slice(-Math.max(1, windowSec - 1)).map(s => s.power)
  vals.push(current)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

export default function TrainPage() {
  const app = useApp()
  const { player, settings, telemetry } = app
  if (!settings) return null

  if (player.status === 'finished' && app.lastFinished) return <FinishedView />
  if (player.status === 'riding' || player.status === 'paused') return <RidingView />
  return <IdleView />
}

// ---------- Vor dem Training ----------
function IdleView() {
  const app = useApp()
  const { settings, workouts, queued, selectedWorkout } = app
  const todayEntry = useMemo(() => app.plan.find(e => e.date === todayIso() && e.kind === 'workout'), [app.plan])
  const todayWorkout = todayEntry ? workouts.find(w => w.id === todayEntry.workoutId) : null
  const workout = selectedWorkout || (queued ? queued.workout : null) || todayWorkout || workouts.find(w => w.id === 'builtin-grundlage-50') || workouts[0]
  const steps = useMemo(() => workout ? expandSegments(workout.segments) : [], [workout])
  const trainerReady = app.trainerState === 'connected'

  return (
    <div>
      <div className="page-title">Training <span className="sub">FTP {settings!.ftp} W</span></div>

      {app.recoveredDraft && <RecoveredDraftBanner draft={app.recoveredDraft} />}

      {queued && (
        <div className="queued-banner">
          <span style={{ fontSize: 20 }}>✨</span>
          <div style={{ flex: 1 }}>
            <b>Von Claude vorgeschlagen: {queued.workout.name}</b>
            <div className="hint">{queued.note || queued.workout.description}</div>
          </div>
          <button className="btn primary" onClick={() => setState({ selectedWorkout: queued.workout })}>Auswählen</button>
          <button className="btn small" onClick={async () => { await bridge.clearQueuedWorkout(); setState({ queued: null }) }}>✕</button>
        </div>
      )}

      {!queued && todayEntry && todayWorkout && !selectedWorkout && (
        <div className="queued-banner">
          <span style={{ fontSize: 20 }}>🗓️</span>
          <div style={{ flex: 1 }}>
            <b>Heute geplant: {todayWorkout.name}</b>
            {todayEntry.note && <div className="hint">{todayEntry.note}</div>}
          </div>
          <button className="btn primary" onClick={() => setState({ selectedWorkout: todayWorkout })}>Auswählen</button>
          <button className="btn small" onClick={() => setState({ page: 'plan' })}>Plan öffnen</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16 }}>{workout?.name || 'Kein Workout gewählt'}</h3>
            <div className="hint">{workout?.description}</div>
          </div>
          <div className="row">
            <span className="hint">{workout && workout.kind !== 'freeride' ? `${fmtDuration(workoutDuration(workout))}` : ''}</span>
            <button className="btn" onClick={() => setState({ page: 'workouts' })}>Programm wählen …</button>
          </div>
        </div>
        {workout && <WorkoutGraph steps={steps} zones={settings!.powerZones} />}
      </div>

      <div className="row wrap" style={{ marginBottom: 16 }}>
        <ConnectButtons />
        <div style={{ flex: 1 }} />
        <button
          className="btn primary big"
          disabled={!workout || !trainerReady}
          title={trainerReady ? '' : 'Zuerst Trainer verbinden'}
          onClick={() => workout && startWorkout(workout)}
        >▶ Workout starten</button>
      </div>
      {!trainerReady && <div className="hint">Verbinde zuerst den Kickr (oder den Simulator zum Testen), dann kann es losgehen.</div>}
    </div>
  )
}

function RecoveredDraftBanner({ draft }: { draft: import('../bridge').DraftSession }) {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const startedNice = new Date(draft.startedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  const restore = async () => {
    setBusy(true)
    const settings = app.settings!
    const summary = computeSummary(draft.samples, draft.ftpAtTime, settings.powerZones)
    await bridge.saveSession({
      id: '', name: draft.name + ' (wiederhergestellt)', workoutId: draft.workoutId,
      startedAt: draft.startedAt, durationSec: draft.samples.length, ftpAtTime: draft.ftpAtTime,
      summary, samples: draft.samples,
    })
    await bridge.clearDraftSession()
    setState({ recoveredDraft: null, sessions: await bridge.listSessions() })
    showToast('Einheit wiederhergestellt und im Verlauf gespeichert.')
  }

  const discard = async () => {
    await bridge.clearDraftSession()
    setState({ recoveredDraft: null })
  }

  return (
    <div className="banner" style={{ borderColor: 'var(--accent-dim)', color: 'var(--text)', background: 'rgba(62,207,142,0.08)' }}>
      <span style={{ fontSize: 18 }}>💾</span>
      <div style={{ flex: 1 }}>
        <b>Unterbrochene Einheit gefunden: {draft.name}</b>
        <div className="hint">Gestartet {startedNice} · {fmtDuration(draft.samples.length)} aufgezeichnet, bevor die App unerwartet geschlossen wurde.</div>
      </div>
      <button className="btn small primary" disabled={busy} onClick={restore}>Wiederherstellen</button>
      <button className="btn small" disabled={busy} onClick={discard}>Verwerfen</button>
    </div>
  )
}

function ConnectButtons() {
  const app = useApp()
  const [busy, setBusy] = useState(false)
  const t = app.trainerState, h = app.hrState

  const doConnect = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) {
      const msg = String((e as Error)?.message || e)
      if (!/cancelled|canceled|User cancelled/i.test(msg)) showToast('Verbindung fehlgeschlagen: ' + msg, 'err')
    } finally { setBusy(false) }
  }

  return (
    <>
      {t === 'connected'
        ? <button className="btn" onClick={disconnectTrainer}><span className="status-dot connected" /> {app.trainerName} ✕</button>
        : <button className="btn" disabled={busy || t === 'connecting'} onClick={() => doConnect(() => connectTrainer(false))}>🚴 Trainer verbinden</button>}
      {h === 'connected'
        ? <button className="btn" onClick={disconnectHr}><span className="status-dot connected" /> {app.hrName} ✕</button>
        : <button className="btn" disabled={busy || h === 'connecting'} onClick={() => doConnect(() => connectHr(false))}>❤️ HF-Gurt verbinden</button>}
      {t !== 'connected' && (
        <button className="btn small" disabled={busy} onClick={() => doConnect(async () => { await connectTrainer(true); await connectHr(true) })}>Simulator</button>
      )}
    </>
  )
}

// ---------- Während der Fahrt ----------
function RidingView() {
  const app = useApp()
  const { player, settings, telemetry } = app
  const p = player
  const ftp = settings!.ftp
  const { step } = targetPctAt(p.steps, p.elapsed)
  const isFreeride = step?.freeride || p.workout?.kind === 'freeride'
  const total = p.steps.length ? p.steps[p.steps.length - 1].endSec : 0
  const stepRemain = step ? step.endSec - p.elapsed : 0
  const nextStep = step ? p.steps[p.steps.indexOf(step) + 1] : null
  const displayPower = smoothPower(p.samples, telemetry.power, settings!.erg.smoothingSec)
  const pctOfFtp = displayPower != null ? (displayPower / ftp) * 100 : 0
  const hrPct = telemetry.hr != null ? (telemetry.hr / settings!.hrMax) * 100 : null

  // Live-Kennzahlen grob (jede Sekunde neu ist ok bei <2h Samples)
  const live = useMemo(() => {
    const powers = p.samples.map(s => s.power)
    const avg = powers.length ? Math.round(powers.reduce((a, b) => a + b, 0) / powers.length) : 0
    const kj = Math.round(powers.reduce((a, b) => a + b, 0) / 1000)
    return { avg, kj }
  }, [p.samples.length])

  return (
    <div>
      {app.dataStale && <div className="banner">⚠ Keine Daten vom Trainer seit &gt;5 s — Verbindung prüfen.</div>}
      {p.status === 'paused' && (
        <div className="banner" style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)', background: 'rgba(232,197,71,0.08)' }}>
          ⏸ Pausiert{p.pausedByDisconnect ? ' — Trainer-Verbindung verloren, Reconnect läuft …' : ''}
        </div>
      )}

      <div className="card" style={{ marginBottom: 14, padding: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
          <b>{p.workout?.name}</b>
          <span className="hint">{fmtDuration(p.elapsed)} / {fmtDuration(total)}</span>
        </div>
        <WorkoutGraph steps={p.steps} zones={settings!.powerZones} elapsed={p.elapsed} samples={p.samples} ftp={ftp} height={110} />
      </div>

      <div className="tile-grid" style={{ marginBottom: 14 }}>
        <div className="tile hero">
          <div className="zonebar" style={{ background: zoneColor(pctOfFtp, settings!.powerZones) }} />
          <div className="label">Leistung ({settings!.erg.smoothingSec}s)</div>
          <div className="value">{displayPower ?? '–'}<span className="unit">W</span></div>
          <div className="sub">Ziel {p.currentTarget} W · {Math.round(pctOfFtp)} % FTP{p.trimPct !== 0 ? ` · Trim ${p.trimPct > 0 ? '+' : ''}${p.trimPct} %` : ''}</div>
        </div>
        <div className="tile">
          <div className="label">Trittfrequenz</div>
          <div className="value">{telemetry.cadence ?? '–'}<span className="unit">rpm</span></div>
        </div>
        <div className="tile">
          {hrPct != null && <div className="zonebar" style={{ background: hrPct > 90 ? 'var(--red)' : hrPct > 80 ? 'var(--orange)' : hrPct > 70 ? 'var(--yellow)' : 'var(--blue)' }} />}
          <div className="label">Herzfrequenz</div>
          <div className="value">{telemetry.hr ?? '–'}<span className="unit">bpm</span></div>
          {hrPct != null && <div className="sub">{Math.round(hrPct)} % HFmax</div>}
        </div>
        <div className="tile">
          <div className="label">{step?.label || 'Segment'}</div>
          <div className="value">{fmtDuration(stepRemain)}</div>
          <div className="sub">{nextStep ? `Danach: ${nextStep.label} (${nextStep.freeride ? 'frei' : Math.round(nextStep.startPct) + ' %'})` : 'Letztes Segment'}</div>
        </div>
        <div className="tile">
          <div className="label">Ø Leistung · Arbeit</div>
          <div className="value" style={{ fontSize: 30 }}>{live.avg}<span className="unit">W</span></div>
          <div className="sub">{live.kj} kJ</div>
        </div>
      </div>

      {isFreeride && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 120 }}>ERG-Zielwert: <b style={{ color: 'var(--text)' }}>{p.freerideTarget} W</b></span>
            <input type="range" min={50} max={Math.max(400, Math.round(settings!.ftp * 1.8))} step={5}
              value={p.freerideTarget} onChange={e => setFreerideTarget(Number(e.target.value))} />
            <button className="btn small" onClick={() => setFreerideTarget(p.freerideTarget - 10)}>−10</button>
            <button className="btn small" onClick={() => setFreerideTarget(p.freerideTarget + 10)}>+10</button>
          </div>
        </div>
      )}

      <div className="row wrap">
        {p.status === 'riding'
          ? <button className="btn big" onClick={() => pauseWorkout(false)}>⏸ Pause</button>
          : <button className="btn primary big" onClick={resumeWorkout}>▶ Weiter</button>}
        {!isFreeride && <>
          <button className="btn" onClick={() => trim(-settings!.erg.trimStepPct)}>− {settings!.erg.trimStepPct} %</button>
          <button className="btn" onClick={() => trim(settings!.erg.trimStepPct)}>+ {settings!.erg.trimStepPct} %</button>
          <button className="btn" onClick={skipSegment}>⏭ Segment überspringen</button>
        </>}
        <div style={{ flex: 1 }} />
        <EndButton />
      </div>
    </div>
  )
}

function EndButton() {
  const [arm, setArm] = useState(false)
  useEffect(() => {
    if (!arm) return
    const t = setTimeout(() => setArm(false), 4000)
    return () => clearTimeout(t)
  }, [arm])
  return arm
    ? <button className="btn danger big" onClick={finishWorkout}>Wirklich beenden &amp; speichern?</button>
    : <button className="btn danger big" onClick={() => setArm(true)}>■ Beenden</button>
}

// ---------- Nach dem Training ----------
function FinishedView() {
  const app = useApp()
  const session = app.lastFinished!
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState<number | null>(session.stravaActivityId ?? null)
  const stravaReady = !!app.settings?.strava.refreshToken

  const upload = async () => {
    setUploading(true)
    const res = await bridge.stravaUpload(session.id)
    setUploading(false)
    if (res.ok) {
      setUploaded(res.activityId ?? null)
      showToast(res.activityId ? 'Bei Strava hochgeladen ✓' : 'Hochgeladen – Strava verarbeitet noch.')
    } else showToast(res.error || 'Upload fehlgeschlagen', 'err')
  }

  const acceptFtp = async () => {
    const s = app.settings!
    const newFtp = app.ftpSuggestion!
    const updated = { ...s, ftp: newFtp, ftpHistory: [...s.ftpHistory, { date: new Date().toISOString().slice(0, 10), ftp: newFtp }] }
    await bridge.setSettings(updated)
    setState({ settings: updated, ftpSuggestion: null })
    showToast(`FTP auf ${newFtp} W aktualisiert.`)
  }

  return (
    <div>
      <div className="page-title">Geschafft! <span className="sub">{session.name}</span></div>

      {app.ftpSuggestion && (
        <div className="queued-banner">
          <span style={{ fontSize: 20 }}>📈</span>
          <div style={{ flex: 1 }}>
            <b>Neue FTP-Schätzung: {app.ftpSuggestion} W</b>
            <div className="hint">75 % deiner besten Minutenleistung ({session.summary.best60s} W). Aktuelle FTP: {app.settings!.ftp} W.</div>
          </div>
          <button className="btn primary" onClick={acceptFtp}>Übernehmen</button>
          <button className="btn" onClick={() => setState({ ftpSuggestion: null })}>Behalten</button>
        </div>
      )}

      <SummaryView session={session} zones={app.settings!.powerZones} />

      <div className="row wrap" style={{ marginTop: 16 }}>
        <button className="btn primary big" disabled={uploading || !stravaReady || uploaded != null} onClick={upload}>
          {uploading ? 'Lade hoch …' : uploaded != null ? '✓ Bei Strava' : '⬆ An Strava senden'}
        </button>
        {uploaded != null && (
          <button className="btn" onClick={() => bridge.openExternal(`https://www.strava.com/activities/${uploaded}`)}>Bei Strava öffnen ↗</button>
        )}
        {!stravaReady && <span className="hint">Strava in den Settings verbinden für direkten Upload.</span>}
        <button className="btn big" onClick={async () => {
          const r = await bridge.exportTcx(session.id)
          if (r.ok) showToast('TCX gespeichert: ' + r.filePath)
          else if (!r.canceled) showToast(r.error || 'Export fehlgeschlagen', 'err')
        }}>💾 TCX exportieren</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={dismissSummary}>Fertig</button>
      </div>
    </div>
  )
}
