// Pläne: mehrwöchige Trainingspläne ansehen und mit Startdatum und Wochentagen in den Kalender eintragen.
import { useEffect, useMemo, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge } from '../bridge'
import { fmtDuration, workoutDuration, type Workout } from '../engine/model'
import {
  PLANS, WEEKDAYS, defaultWeekdays, maxSessionsPerWeek, mondayOf, nextMonday, schedulePlan, weekStats, workoutTss,
  type TrainingPlan,
} from '../engine/plans'

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function PlansPage() {
  const app = useApp()
  const [selected, setSelected] = useState<TrainingPlan | null>(null)
  const [start, setStart] = useState(nextMonday())
  const [days, setDays] = useState<number[]>([])
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map<string, Workout>(app.workouts.map(w => [w.id, w])), [app.workouts])

  useEffect(() => { if (selected) setDays(defaultWeekdays(maxSessionsPerWeek(selected))) }, [selected?.id])

  const need = selected ? maxSessionsPerWeek(selected) : 0
  const schedule = useMemo(() => selected && days.length === need ? schedulePlan(selected, start, days) : [], [selected, start, days, need])
  const lastDate = schedule.length ? schedule[schedule.length - 1].date : null
  const conflicts = useMemo(() => {
    const taken = new Set(app.plan.filter(e => e.kind !== 'event').map(e => e.date))
    return schedule.filter(s => taken.has(s.date)).length
  }, [schedule, app.plan])
  const missing = selected ? selected.weeks.flatMap(w => w.sessions).filter(s => !byId.has(s.workoutId)).length : 0

  const toggleDay = (d: number) => setDays(cur => cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort((a, b) => a - b))

  const apply = async () => {
    if (!selected || schedule.length === 0) return
    setBusy(true)
    for (const s of schedule) {
      const w = byId.get(s.workoutId)
      if (!w) continue
      await bridge.savePlanEntry({ id: '', date: s.date, workoutId: w.id, workoutName: w.name, note: s.note, kind: 'workout' })
    }
    setState({ plan: await bridge.listPlan(), page: 'plan' })
    setBusy(false)
    showToast(`${schedule.length} Einheiten aus „${selected.name}“ im Kalender eingetragen ✓`)
  }

  return (
    <div>
      <div className="page-title">Pläne <span className="sub">{PLANS.length} Trainingspläne · FTP {app.settings?.ftp} W</span></div>

      <div className="tours-layout">
        {/* ---- links: Pläne ---- */}
        <div className="tours-list">
          <div className="card hint" style={{ marginBottom: 12 }}>
            Eigene Pläne nach gängigen Trainingsprinzipien. Alle Einheiten sind in %FTP definiert und skalieren mit deiner FTP.
            Eigene Workouts kannst du unter „Programme“ als .zwo-Datei importieren.
          </div>
          {PLANS.map(p => {
            const stats = p.weeks.map(w => weekStats(w, byId))
            const avgSec = stats.reduce((a, s) => a + s.sec, 0) / p.weeks.length
            const avgTss = stats.reduce((a, s) => a + s.tss, 0) / p.weeks.length
            return (
              <div key={p.id} className="card" onClick={() => setSelected(p)}
                style={{ cursor: 'pointer', marginBottom: 10, borderColor: selected?.id === p.id ? 'var(--accent)' : undefined }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                  <span className="tag">{p.level}</span>
                </div>
                <div className="hint" style={{ margin: '4px 0 8px' }}>{p.goal}</div>
                <div className="meta" style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                  <span>{p.weeks.length} Wochen</span>
                  <span>{maxSessionsPerWeek(p)} Einheiten/Woche</span>
                  <span>Ø {(avgSec / 3600).toFixed(1)} h/Woche</span>
                  <span>Ø {Math.round(avgTss)} TSS/Woche</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* ---- rechts: Detail ---- */}
        <div className="tours-detail">
          {!selected && <div className="card hint">Wähle links einen Plan. Hier siehst du dann die Wochen und kannst ihn in den Kalender eintragen.</div>}

          {selected && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <h3 style={{ fontSize: 17 }}>{selected.name}</h3>
                <button className="btn small" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className="hint" style={{ marginBottom: 12 }}>{selected.description}</div>

              <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                <table className="list">
                  <thead><tr><th>Woche</th><th>Einheiten</th><th>Dauer</th><th>TSS</th></tr></thead>
                  <tbody>
                    {selected.weeks.map((w, i) => {
                      const st = weekStats(w, byId)
                      return (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}><b>{w.title}</b>{w.note && <div className="hint">{w.note}</div>}</td>
                          <td>
                            {w.sessions.map((s, k) => {
                              const wo = byId.get(s.workoutId)
                              return <div key={k} style={{ fontSize: 13 }}>{wo ? `${wo.name} · ${fmtDuration(workoutDuration(wo))} · ${workoutTss(wo)} TSS` : '(Workout fehlt)'}</div>
                            })}
                          </td>
                          <td>{(st.sec / 3600).toFixed(1)} h</td>
                          <td>{Math.round(st.tss)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <h4 style={{ fontSize: 14, marginBottom: 8 }}>In den Kalender eintragen</h4>
              <div className="row wrap" style={{ gap: 12, marginBottom: 10 }}>
                <label className="field" style={{ minWidth: 190 }}>Start (Woche beginnt Montag)
                  <input type="date" value={start} onChange={e => e.target.value && setStart(mondayOf(e.target.value))} />
                </label>
                <div>
                  <div className="hint" style={{ marginBottom: 6 }}>Trainingstage ({days.length} von {need} gewählt)</div>
                  <div className="row" style={{ gap: 6 }}>
                    {WEEKDAYS.map((n, d) => (
                      <button key={d} className={`btn small${days.includes(d) ? ' primary' : ''}`} onClick={() => toggleDay(d)}>{n}</button>
                    ))}
                  </div>
                </div>
              </div>

              {days.length !== need && <div className="hint" style={{ color: 'var(--yellow)' }}>Bitte genau {need} Wochentage wählen — so viele Einheiten hat die vollste Woche.</div>}
              {lastDate && (
                <div className="hint">
                  Wird eingetragen von {fmtDate(schedule[0].date)} bis {fmtDate(lastDate)} ({schedule.length} Einheiten).
                  {conflicts > 0 && ` An ${conflicts} dieser Tage steht schon etwas im Kalender — die Einheiten werden zusätzlich eingetragen.`}
                  {' '}Im Kalender kannst du jede Einheit später verschieben, z. B. wenn sich Homeoffice-Tage ändern.
                </div>
              )}
              {missing > 0 && <div className="hint" style={{ color: 'var(--red)' }}>{missing} Workout(s) dieses Plans sind nicht vorhanden und werden übersprungen.</div>}

              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn primary big" disabled={busy || schedule.length === 0} onClick={apply}>
                  {busy ? 'Trage ein …' : '🗓️ Plan in den Kalender eintragen'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
