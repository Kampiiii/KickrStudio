// Trainingsplan: Monatskalender mit geplanten Einheiten, Pausen und Ereignissen.
// Absolvierte Einheiten (aus dem Verlauf) werden automatisch abgehakt.
import { useMemo, useState, type DragEvent } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge, type PlanEntry } from '../bridge'
import { fmtDuration, workoutDuration } from '../engine/model'
import { startWorkout } from '../engine/player'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PlanPage() {
  const app = useApp()
  const today = isoDate(new Date())
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [editDay, setEditDay] = useState<string | null>(null)

  // Tage mit absolvierten Einheiten (für die ✓-Markierung)
  const doneDates = useMemo(() => new Set(app.sessions.map(s => s.startedAt.slice(0, 10))), [app.sessions])
  const byDate = useMemo(() => {
    const m = new Map<string, PlanEntry[]>()
    for (const e of app.plan) { const l = m.get(e.date) || []; l.push(e); m.set(e.date, l) }
    return m
  }, [app.plan])

  // Kalendergitter: Wochen des Monats (Montag als Wochenstart)
  const weeks = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const start = new Date(first)
    start.setDate(1 - ((first.getDay() + 6) % 7))
    const out: Date[][] = []
    const d = new Date(start)
    do {
      const week: Date[] = []
      for (let i = 0; i < 7; i++) { week.push(new Date(d)); d.setDate(d.getDate() + 1) }
      out.push(week)
    } while (d.getMonth() === cursor.m && d.getFullYear() === cursor.y)
    return out
  }, [cursor])

  const nav = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1)
    setCursor({ y: d.getFullYear(), m: d.getMonth() })
  }

  // Drag & Drop: Einträge flexibel auf andere Tage ziehen (Homeoffice-Tage variieren)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const onDrop = async (targetDate: string, ev: DragEvent) => {
    ev.preventDefault()
    setDragOver(null)
    const id = ev.dataTransfer.getData('text/plan-entry')
    if (!id) return
    const entry = app.plan.find(e => e.id === id)
    if (!entry || entry.date === targetDate) return
    await bridge.savePlanEntry({ ...entry, date: targetDate })
    setState({ plan: await bridge.listPlan() })
    showToast(`Verschoben auf ${new Date(targetDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}.`)
  }

  return (
    <div>
      <div className="page-title">
        Plan <span className="sub">3×/Woche · Claude kann den Plan über MCP fortschreiben</span>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={() => nav(-1)}>←</button>
        <span style={{ fontSize: 15, minWidth: 150, textAlign: 'center' }}>{MONTHS[cursor.m]} {cursor.y}</span>
        <button className="btn small" onClick={() => nav(1)}>→</button>
        <button className="btn small" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }) }}>Heute</button>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map(w => <div key={w} className="cal-head">{w}</div>)}
        {weeks.flat().map(d => {
          const ds = isoDate(d)
          const inMonth = d.getMonth() === cursor.m
          const entries = byDate.get(ds) || []
          const done = doneDates.has(ds)
          return (
            <div key={ds}
              className={`cal-day ${inMonth ? '' : 'dim'} ${ds === today ? 'today' : ''} ${dragOver === ds ? 'dragover' : ''}`}
              onClick={() => setEditDay(ds)}
              onDragOver={ev => { ev.preventDefault(); setDragOver(ds) }}
              onDragLeave={() => setDragOver(cur => cur === ds ? null : cur)}
              onDrop={ev => onDrop(ds, ev)}>
              <div className="cal-date">{d.getDate()}{done && <span className="cal-done">✓</span>}</div>
              {entries.map(e => (
                <div key={e.id} className={`cal-entry ${e.kind || 'workout'} ${done ? 'entry-done' : ''}`}
                  title={(e.note ? e.note + ' — ' : '') + 'Zum Verschieben ziehen'}
                  draggable
                  onDragStart={ev => { ev.dataTransfer.setData('text/plan-entry', e.id); ev.dataTransfer.effectAllowed = 'move' }}>
                  {e.kind === 'event' ? '📌 ' : e.kind === 'rest' ? '🛌 ' : ''}{e.workoutName}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {editDay && <DayEditor date={editDay} entries={byDate.get(editDay) || []} done={doneDates.has(editDay)} onClose={() => setEditDay(null)} />}
    </div>
  )
}

function DayEditor({ date, entries, done, onClose }: { date: string; entries: PlanEntry[]; done: boolean; onClose: () => void }) {
  const app = useApp()
  const [workoutId, setWorkoutId] = useState(app.workouts[0]?.id || '')
  const [note, setNote] = useState('')
  const nice = new Date(date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const canRide = app.trainerState === 'connected' && app.player.status === 'idle'

  const addWorkout = async () => {
    const w = app.workouts.find(x => x.id === workoutId)
    if (!w) return
    await bridge.savePlanEntry({ id: '', date, workoutId: w.id, workoutName: w.name, note, kind: 'workout' })
    setState({ plan: await bridge.listPlan() })
    showToast('Einheit eingeplant.')
    onClose()
  }

  const addMarker = async (kind: 'rest' | 'event', name: string) => {
    await bridge.savePlanEntry({ id: '', date, workoutName: name, note, kind })
    setState({ plan: await bridge.listPlan() })
    onClose()
  }

  const moveEntry = async (entry: PlanEntry, newDate: string) => {
    if (!newDate || newDate === entry.date) return
    await bridge.savePlanEntry({ ...entry, date: newDate })
    setState({ plan: await bridge.listPlan() })
    showToast(`Verschoben auf ${new Date(newDate + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}.`)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{nice} {done && <span style={{ color: 'var(--accent)' }}>✓ trainiert</span>}</h3>

        {entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {entries.map(e => {
              const w = e.workoutId ? app.workouts.find(x => x.id === e.workoutId) : null
              return (
                <div key={e.id} className="device-item" style={{ cursor: 'default' }}>
                  <div style={{ flex: 1 }}>
                    <b>{e.kind === 'event' ? '📌 ' : e.kind === 'rest' ? '🛌 ' : ''}{e.workoutName}</b>
                    {w && <span className="hint"> · {fmtDuration(workoutDuration(w))}</span>}
                    {e.note && <div className="hint">{e.note}</div>}
                  </div>
                  <input type="date" defaultValue={e.date} title="Auf anderes Datum verschieben"
                    style={{ width: 140 }}
                    onChange={ev => moveEntry(e, ev.target.value)} />
                  {w && <button className="btn small primary" disabled={!canRide}
                    title={canRide ? '' : 'Trainer verbinden (Training-Seite)'}
                    onClick={() => { onClose(); startWorkout(w) }}>▶ Starten</button>}
                  <button className="btn small danger" onClick={async () => {
                    await bridge.deletePlanEntry(e.id)
                    setState({ plan: await bridge.listPlan() })
                  }}>✕</button>
                </div>
              )
            })}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field">Einheit planen
            <select value={workoutId} onChange={e => setWorkoutId(e.target.value)}>
              {app.workouts.map(w => <option key={w.id} value={w.id}>{w.name}{w.kind !== 'freeride' ? ` (${fmtDuration(workoutDuration(w))})` : ''}</option>)}
            </select>
          </label>
          <label className="field">Notiz (optional)
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="z.B. locker bleiben, vor der Arbeit" />
          </label>
          <div className="row wrap">
            <button className="btn primary" onClick={addWorkout}>+ Einplanen</button>
            <button className="btn" onClick={() => addMarker('rest', 'Pause')}>🛌 Pause markieren</button>
            <button className="btn" onClick={() => addMarker('event', note || 'Termin')}>📌 Ereignis</button>
            <div style={{ flex: 1 }} />
            <button className="btn" onClick={onClose}>Schließen</button>
          </div>
        </div>
      </div>
    </div>
  )
}
