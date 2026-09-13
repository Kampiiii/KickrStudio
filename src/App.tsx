import { useEffect } from 'react'
import { useApp, setState, type Page } from './state'
import { bridge } from './bridge'
import TrainPage from './pages/TrainPage'
import PlanPage from './pages/PlanPage'
import WorkoutsPage, { loadAllWorkouts } from './pages/WorkoutsPage'
import HistoryPage from './pages/HistoryPage'
import BodyPage from './pages/BodyPage'
import SettingsPage from './pages/SettingsPage'
import DevicePicker from './components/DevicePicker'
import { fmtDuration } from './engine/model'

const NAV: { page: Page; label: string; ico: string }[] = [
  { page: 'train', label: 'Training', ico: '🚴' },
  { page: 'plan', label: 'Plan', ico: '🗓️' },
  { page: 'workouts', label: 'Programme', ico: '📋' },
  { page: 'history', label: 'Verlauf', ico: '📈' },
  { page: 'body', label: 'Körper', ico: '⚖️' },
  { page: 'settings', label: 'Einstellungen', ico: '⚙️' },
]

async function loadAll() {
  const [settings, workouts, sessions, queued, plan] = await Promise.all([
    bridge.getSettings(), loadAllWorkouts(), bridge.listSessions(), bridge.getQueuedWorkout(), bridge.listPlan(),
  ])
  setState({ settings, workouts, sessions, queued, plan })
  // Snapshot der eingebauten Programme für den MCP-Server hinterlegen
  if (bridge.snapshotBuiltins) {
    const { BUILTIN_WORKOUTS } = await import('./engine/library')
    bridge.snapshotBuiltins(BUILTIN_WORKOUTS)
  }
}

export default function App() {
  const app = useApp()

  useEffect(() => {
    loadAll()
    // Einmalig prüfen, ob eine unterbrochene Einheit (Absturz/Schließen während
    // des Trainings) zur Wiederherstellung bereitliegt.
    bridge.getDraftSession().then(draft => { if (draft) setState({ recoveredDraft: draft }) })
    // MCP-Server oder andere Prozesse haben Dateien geändert → neu laden
    return bridge.onDataChanged(() => { loadAll() })
  }, [])

  if (!app.settings) return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  const riding = app.player.status === 'riding' || app.player.status === 'paused'

  return (
    <div className="app">
      <div className="sidebar">
        <div className="brand"><span className="dot" /> KickrStudio</div>
        {NAV.map(n => (
          <button key={n.page} className={`nav-item ${app.page === n.page ? 'active' : ''}`} onClick={() => setState({ page: n.page })}>
            <span className="ico">{n.ico}</span> {n.label}
            {n.page === 'train' && riding && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--accent)' }}>{fmtDuration(app.player.elapsed)}</span>}
          </button>
        ))}
        <div className="spacer" />
        <div className="conn-summary">
          <div className="conn-line"><span className={`status-dot ${app.trainerState}`} /> {app.trainerName || 'Kein Trainer'}</div>
          <div className="conn-line"><span className={`status-dot ${app.hrState}`} /> {app.hrName || 'Kein HF-Gurt'}</div>
        </div>
      </div>
      <div className="content">
        {app.page === 'train' && <TrainPage />}
        {app.page === 'plan' && <PlanPage />}
        {app.page === 'workouts' && <WorkoutsPage />}
        {app.page === 'history' && <HistoryPage />}
        {app.page === 'body' && <BodyPage />}
        {app.page === 'settings' && <SettingsPage />}
      </div>
      <DevicePicker />
      {app.toast && <div className={`toast ${app.toast.kind}`}>{app.toast.text}</div>}
    </div>
  )
}
