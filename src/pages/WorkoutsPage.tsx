import { useMemo, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge } from '../bridge'
import { expandSegments, fmtDuration, workoutDuration, type Segment, type Workout } from '../engine/model'
import WorkoutGraph from '../components/WorkoutGraph'
import { startWorkout } from '../engine/player'

export default function WorkoutsPage() {
  const app = useApp()
  const [editing, setEditing] = useState<Workout | null>(null)
  const [filter, setFilter] = useState('')

  const workouts = app.workouts.filter(w =>
    !filter || w.name.toLowerCase().includes(filter.toLowerCase()) || (w.tags || []).some(t => t.toLowerCase().includes(filter.toLowerCase()))
  )

  if (editing) return <WorkoutEditor workout={editing} onClose={() => setEditing(null)} />

  return (
    <div>
      <div className="page-title">Programme <span className="sub">{app.workouts.length} Workouts · FTP {app.settings?.ftp} W</span></div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input type="text" placeholder="Suchen …" value={filter} onChange={e => setFilter(e.target.value)} style={{ maxWidth: 260 }} />
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setEditing({
          id: '', name: 'Neues Workout', description: '', source: 'custom',
          segments: [
            { type: 'warmup', sec: 600, fromPct: 40, toPct: 70 },
            { type: 'steady', sec: 1200, pct: 75 },
            { type: 'cooldown', sec: 300, fromPct: 60, toPct: 40 },
          ],
        })}>+ Neues Workout</button>
      </div>
      <div className="workout-grid">
        {workouts.map(w => <WorkoutCard key={w.id} workout={w} onEdit={() => setEditing(JSON.parse(JSON.stringify(w)))} />)}
      </div>
    </div>
  )
}

function WorkoutCard({ workout, onEdit }: { workout: Workout; onEdit: () => void }) {
  const app = useApp()
  const steps = useMemo(() => expandSegments(workout.segments), [workout])
  const dur = workoutDuration(workout)
  const busy = app.player.status === 'riding' || app.player.status === 'paused'
  return (
    <div className="card workout-card" onClick={() => { setState({ selectedWorkout: workout, page: 'train' }) }}>
      <h4>{workout.name} {workout.source === 'claude' && <span title="Von Claude erstellt">✨</span>}</h4>
      <div className="meta">
        <span>{workout.kind === 'freeride' ? 'offen' : fmtDuration(dur)}</span>
        {(workout.tags || []).map(t => <span className="tag" key={t}>{t}</span>)}
      </div>
      <WorkoutGraph steps={steps} zones={app.settings!.powerZones} height={64} />
      <div className="desc">{workout.description}</div>
      <div className="row" style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
        <button className="btn small primary" disabled={busy} onClick={() => startWorkout(workout)}>▶ Starten</button>
        <button className="btn small" onClick={onEdit}>{workout.source === 'builtin' ? 'Als Vorlage …' : 'Bearbeiten'}</button>
        {workout.source !== 'builtin' && (
          <button className="btn small danger" onClick={async () => {
            if (!confirm(`„${workout.name}“ löschen?`)) return
            await bridge.deleteWorkout(workout.id)
            setState({ workouts: (await loadAllWorkouts()) })
          }}>Löschen</button>
        )}
      </div>
    </div>
  )
}

export async function loadAllWorkouts(): Promise<Workout[]> {
  const { BUILTIN_WORKOUTS } = await import('../engine/library')
  const custom = await bridge.listWorkouts()
  return [...BUILTIN_WORKOUTS, ...custom.filter(c => !BUILTIN_WORKOUTS.some(b => b.id === c.id))]
}

// ---------- Editor ----------
function WorkoutEditor({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const app = useApp()
  const [w, setW] = useState<Workout>(() => workout.source === 'builtin'
    ? { ...workout, id: '', name: workout.name + ' (Kopie)', source: 'custom' }
    : workout)
  const steps = useMemo(() => expandSegments(w.segments), [w])

  const upd = (patch: Partial<Workout>) => setW({ ...w, ...patch })
  const updSeg = (i: number, seg: Segment) => {
    const segments = [...w.segments]; segments[i] = seg; upd({ segments })
  }
  const delSeg = (i: number) => upd({ segments: w.segments.filter((_, j) => j !== i) })
  const addSeg = (type: Segment['type']) => {
    const seg: Segment =
      type === 'steady' ? { type, sec: 600, pct: 75 } :
      type === 'intervals' ? { type, reps: 4, onSec: 240, onPct: 105, offSec: 180, offPct: 50 } :
      type === 'freeride' ? { type, sec: 600 } :
      { type, sec: 600, fromPct: 40, toPct: 70 }
    upd({ segments: [...w.segments, seg] })
  }

  const save = async () => {
    if (!w.name.trim()) { showToast('Name fehlt.', 'err'); return }
    if (!w.segments.length) { showToast('Mindestens ein Segment nötig.', 'err'); return }
    await bridge.saveWorkout(w)
    setState({ workouts: await loadAllWorkouts() })
    showToast('Workout gespeichert.')
    onClose()
  }

  return (
    <div>
      <div className="page-title">Workout bearbeiten <span className="sub">{fmtDuration(workoutDuration(w))}</span></div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field" style={{ flex: 1 }}>Name<input type="text" value={w.name} onChange={e => upd({ name: e.target.value })} /></label>
          <label className="field" style={{ flex: 2 }}>Beschreibung<input type="text" value={w.description || ''} onChange={e => upd({ description: e.target.value })} /></label>
        </div>
        <WorkoutGraph steps={steps} zones={app.settings!.powerZones} height={110} />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {w.segments.map((seg, i) => <SegmentRow key={i} seg={seg} onChange={s => updSeg(i, s)} onDelete={() => delSeg(i)} />)}
        <div className="row wrap" style={{ marginTop: 10 }}>
          <span className="hint">Segment hinzufügen:</span>
          <button className="btn small" onClick={() => addSeg('warmup')}>Aufwärmen</button>
          <button className="btn small" onClick={() => addSeg('steady')}>Konstant</button>
          <button className="btn small" onClick={() => addSeg('intervals')}>Intervalle</button>
          <button className="btn small" onClick={() => addSeg('ramp')}>Rampe</button>
          <button className="btn small" onClick={() => addSeg('cooldown')}>Ausfahren</button>
        </div>
      </div>

      <div className="row">
        <button className="btn primary big" onClick={save}>Speichern</button>
        <button className="btn big" onClick={onClose}>Abbrechen</button>
      </div>
    </div>
  )
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="field">{label}
      <input type="number" value={value} step={step} onChange={e => onChange(Number(e.target.value))} />
    </label>
  )
}

function SegmentRow({ seg, onChange, onDelete }: { seg: Segment; onChange: (s: Segment) => void; onDelete: () => void }) {
  const names: Record<string, string> = { warmup: 'Aufwärmen', steady: 'Konstant', intervals: 'Intervalle', ramp: 'Rampe', cooldown: 'Ausfahren', freeride: 'Frei' }
  return (
    <div className="seg-row">
      <div style={{ fontSize: 13, fontWeight: 600, paddingBottom: 9 }}>{names[seg.type]}</div>
      {seg.type === 'steady' && <>
        <NumField label="Minuten" value={seg.sec / 60} step={0.5} onChange={v => onChange({ ...seg, sec: Math.round(v * 60) })} />
        <NumField label="% FTP" value={seg.pct} onChange={v => onChange({ ...seg, pct: v })} />
        <div /><div />
      </>}
      {(seg.type === 'warmup' || seg.type === 'cooldown' || seg.type === 'ramp') && <>
        <NumField label="Minuten" value={seg.sec / 60} step={0.5} onChange={v => onChange({ ...seg, sec: Math.round(v * 60) })} />
        <NumField label="Von % FTP" value={seg.fromPct} onChange={v => onChange({ ...seg, fromPct: v })} />
        <NumField label="Bis % FTP" value={seg.toPct} onChange={v => onChange({ ...seg, toPct: v })} />
        <div />
      </>}
      {seg.type === 'intervals' && <>
        <NumField label="Wdh." value={seg.reps} onChange={v => onChange({ ...seg, reps: Math.max(1, Math.round(v)) })} />
        <NumField label="Last min / %" value={seg.onSec / 60} step={0.5} onChange={v => onChange({ ...seg, onSec: Math.round(v * 60) })} />
        <NumField label="Last % FTP" value={seg.onPct} onChange={v => onChange({ ...seg, onPct: v })} />
        <div className="row" style={{ gap: 8 }}>
          <NumField label="Pause min" value={seg.offSec / 60} step={0.5} onChange={v => onChange({ ...seg, offSec: Math.round(v * 60) })} />
          <NumField label="Pause %" value={seg.offPct} onChange={v => onChange({ ...seg, offPct: v })} />
        </div>
      </>}
      {seg.type === 'freeride' && <>
        <NumField label="Minuten" value={seg.sec / 60} onChange={v => onChange({ ...seg, sec: Math.round(v * 60) })} />
        <div /><div /><div />
      </>}
      <button className="btn small danger" style={{ marginBottom: 2 }} onClick={onDelete}>✕</button>
    </div>
  )
}
