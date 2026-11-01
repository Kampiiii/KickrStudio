import { useEffect, useState } from 'react'
import { bridge, type Checkin, type Recommendation } from '../bridge'
import { setState, showToast, useApp } from '../state'

const PHASE_LABEL: Record<string, string> = {
  start: 'Wiedereinstieg · Start', aufbau1: 'Wiedereinstieg · Aufbau 1', aufbau2: 'Wiedereinstieg · Aufbau 2', normal: 'Normaler Trainingsbetrieb',
}

const todayIso = () => new Date().toLocaleDateString('sv-SE')
const KEY = 'kickr.checkin'

function loadCheckin(): Checkin {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v?.day === todayIso() ? v.data : {} } catch { return {} }
}

// Tagesempfehlung des Cloud-Trainers. Die Grenzen kommen aus dem Wächter (deterministisch), Gemini wählt nur darin.
export default function TrainerCard() {
  const { workouts } = useApp()
  const [rec, setRec] = useState<Recommendation | null>(null)
  const [checkin, setCheckin] = useState<Checkin>(loadCheckin)

  useEffect(() => {
    let alive = true
    bridge.cloudRecommendation().then(r => { if (alive && r.ok) setRec(r.recommendation ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!rec) return null

  const complaints = !!(checkin.dizzy || checkin.ear_pressure || checkin.pain)
  const workout = rec.workoutId ? workouts.find(w => w.id === rec.workoutId) : null
  const stale = rec.day !== todayIso()

  const report = async (patch: Checkin) => {
    const next = { ...checkin, ...patch }
    setCheckin(next)
    try { localStorage.setItem(KEY, JSON.stringify({ day: todayIso(), data: next })) } catch { /* ohne Speicher weiter */ }
    const r = await bridge.cloudCheckin(next)
    if (r.ok) showToast('Check-in gespeichert — der Trainer berücksichtigt ihn bei der nächsten Berechnung.')
    else showToast(r.error || 'Check-in konnte nicht gespeichert werden', 'err')
  }

  return (
    <div className="queued-banner" style={{ flexWrap: 'wrap' }}>
      <span style={{ fontSize: 20 }}>🧑‍🏫</span>
      <div style={{ flex: 1, minWidth: 240 }}>
        <b>Heutige Empfehlung{workout ? `: ${workout.name}` : rec.restDay ? ': Ruhetag' : ''}</b>
        <div className="hint">{PHASE_LABEL[rec.phase] || rec.phase}{stale ? ` · Stand ${rec.day}` : ''}{rec.source === 'regel' ? ' · feste Regel' : ''}</div>
        <div style={{ marginTop: 4 }}>{rec.text}</div>
        {complaints && <div style={{ marginTop: 4, color: 'var(--warn, #e0a030)' }}>
          Du hast Beschwerden gemeldet: Heute besser kein Training. Halten sie an, sprich mit deiner Ärztin oder deinem Arzt.
        </div>}
        {checkin.tired && !complaints && <div className="hint" style={{ marginTop: 4 }}>Müde gemeldet: heute nur locker fahren.</div>}
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          <span className="hint">Check-in:</span>
          <button className={'btn small' + (checkin.tired ? ' primary' : '')} onClick={() => report({ tired: !checkin.tired })}>Müde</button>
          <button className={'btn small' + (checkin.dizzy ? ' primary' : '')} onClick={() => report({ dizzy: !checkin.dizzy })}>Schwindel</button>
          <button className={'btn small' + (checkin.ear_pressure ? ' primary' : '')} onClick={() => report({ ear_pressure: !checkin.ear_pressure })}>Ohrdruck</button>
          <button className={'btn small' + (checkin.pain ? ' primary' : '')} onClick={() => report({ pain: !checkin.pain })}>Schmerzen</button>
        </div>
      </div>
      {workout && !complaints && <button className="btn primary" onClick={() => setState({ selectedWorkout: workout })}>Auswählen</button>}
    </div>
  )
}
