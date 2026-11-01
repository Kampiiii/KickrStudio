// Programm-Vorschlag des Coaches: Vorschau mit Verlauf, gespeichert wird erst nach Klick des Nutzers.
import { useMemo, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge, type WorkoutProposal } from '../bridge'
import { expandSegments, fmtDuration, workoutDuration, type Workout } from '../engine/model'
import { workoutTss } from '../engine/plans'
import { loadAllWorkouts } from '../pages/WorkoutsPage'
import WorkoutGraph from './WorkoutGraph'

export default function WorkoutProposalCard({ proposal }: { proposal: WorkoutProposal }) {
  const app = useApp()
  const [saved, setSaved] = useState<Workout | null>(null)
  const [busy, setBusy] = useState(false)

  const draft: Workout = useMemo(() => ({
    id: '', name: proposal.name, description: proposal.description || '', source: 'custom',
    tags: [...new Set([...(proposal.tags || []), 'Coach'])], segments: proposal.segments,
  }), [proposal])
  const steps = useMemo(() => expandSegments(draft.segments), [draft])
  const ftp = app.settings?.ftp || 200

  const save = async (): Promise<Workout | null> => {
    if (saved) return saved
    setBusy(true)
    try {
      const w = await bridge.saveWorkout(draft)
      setSaved(w)
      setState({ workouts: await loadAllWorkouts() })
      showToast(`„${w.name}“ unter Programme gespeichert ✓`)
      return w
    } catch (e) {
      showToast('Speichern fehlgeschlagen: ' + (e as Error).message, 'err')
      return null
    } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 10, background: 'var(--bg-raised)' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <b>📋 {draft.name}</b>
        <span className="hint">{fmtDuration(workoutDuration(draft))} · ca. {workoutTss(draft)} TSS</span>
      </div>
      {draft.description && <div className="hint" style={{ marginBottom: 8 }}>{draft.description}</div>}
      <WorkoutGraph steps={steps} zones={app.settings!.powerZones} height={70} />
      <div className="hint" style={{ margin: '6px 0 10px' }}>Leistungen in % FTP, bei deiner FTP von {ftp} W also z. B. 100 % = {ftp} W.</div>
      <div className="row wrap">
        {!saved && <button className="btn small primary" disabled={busy} onClick={save}>💾 Speichern</button>}
        {!saved && <button className="btn small" disabled={busy} onClick={async () => { const w = await save(); if (w) setState({ selectedWorkout: w, page: 'train' }) }}>▶ Speichern &amp; zum Training</button>}
        {saved && <>
          <span style={{ color: 'var(--accent)', fontSize: 13 }}>✓ Gespeichert unter Programme</span>
          <button className="btn small primary" onClick={() => setState({ selectedWorkout: saved, page: 'train' })}>▶ Zum Training</button>
          <button className="btn small" onClick={() => setState({ page: 'workouts' })}>Programme öffnen</button>
        </>}
      </div>
    </div>
  )
}
