// Touren: frühere Outdoor-Fahrten mit GPS als virtuelle Strecke auf dem Trainer nachfahren.
import { useEffect, useMemo, useState } from 'react'
import { useApp, showToast } from '../state'
import { bridge, type SessionMeta } from '../bridge'
import { fmtDuration } from '../engine/model'
import { buildTour, estimateDurationSec, RIDER, type Tour } from '../engine/tour'
import { startTour } from '../engine/player'
import TourMap from '../components/TourMap'
import ElevationProfile from '../components/ElevationProfile'
import { ConnectButtons } from './TrainPage'

type Sort = 'date' | 'distance' | 'ascent'
const PAGE = 100

function loadDifficulty(): number {
  try { const v = Number(localStorage.getItem('ks-tour-difficulty')); return v > 0 && v <= 1 ? v : 0.6 } catch { return 0.6 }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function ToursPage() {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('date')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<SessionMeta | null>(null)
  const [tour, setTour] = useState<Tour | null>(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<'sim' | 'erg'>('sim')
  const [difficulty, setDifficulty] = useState(loadDifficulty)

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = app.sessions.filter(s =>
      s.source === 'strava' && s.sport === 'bike' && s.hasGps && (s.distanceM || 0) >= 3000 &&
      (!q || s.name.toLowerCase().includes(q)))
    const by: Record<Sort, (a: SessionMeta, b: SessionMeta) => number> = {
      date: (a, b) => b.startedAt.localeCompare(a.startedAt),
      distance: (a, b) => (b.distanceM || 0) - (a.distanceM || 0),
      ascent: (a, b) => (b.elevationGainM || 0) - (a.elevationGainM || 0),
    }
    return list.sort(by[sort])
  }, [app.sessions, query, sort])

  useEffect(() => {
    if (!selected) { setTour(null); return }
    let cancelled = false
    setLoading(true)
    bridge.getSession(selected.id).then(full => {
      if (cancelled) return
      const t = full ? buildTour(full) : null
      if (!t) showToast('Aus dieser Fahrt lässt sich keine Strecke bauen (zu wenige GPS-Daten).', 'err')
      setTour(t)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [selected?.id])

  const setDiff = (d: number) => {
    setDifficulty(d)
    try { localStorage.setItem('ks-tour-difficulty', String(d)) } catch { /* nur Komfort */ }
  }

  const ftp = app.settings!.ftp
  const mass = (app.settings!.weightKg || 78) + RIDER.bikeKg
  const trainerReady = app.trainerState === 'connected'
  const info = useMemo(() => {
    if (!tour) return null
    return {
      maxGrade: Math.max(...tour.grade),
      eta: estimateDurationSec(tour, ftp * 0.65, mass, difficulty),
    }
  }, [tour, ftp, mass, difficulty])

  return (
    <div>
      <div className="page-title">Touren <span className="sub">{candidates.length} Strecken aus deinen Outdoor-Fahrten</span></div>

      {selected && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <h3 style={{ fontSize: 16 }}>🗺️ {selected.name}</h3>
              <div className="hint">{fmtDate(selected.startedAt)} · gefahren in {fmtDuration(selected.durationSec)}</div>
            </div>
            <button className="btn small" onClick={() => setSelected(null)}>✕ Schließen</button>
          </div>

          {loading && <div className="hint"><span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />Lade Strecke …</div>}
          {!loading && !tour && <div className="hint">Für diese Fahrt gibt es keine nutzbare Strecke.</div>}

          {tour && info && (
            <>
              <div className="tile-grid" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                <div className="tile"><div className="label">Distanz</div><div className="value" style={{ fontSize: 28 }}>{(tour.distanceM / 1000).toFixed(1)}<span className="unit">km</span></div></div>
                <div className="tile"><div className="label">Anstieg</div><div className="value" style={{ fontSize: 28 }}>{tour.ascentM}<span className="unit">m</span></div></div>
                <div className="tile"><div className="label">Max. Steigung</div><div className="value" style={{ fontSize: 28 }}>{info.maxGrade.toFixed(0)}<span className="unit">%</span></div></div>
                <div className="tile"><div className="label">Geschätzt bei 65 % FTP</div><div className="value" style={{ fontSize: 28 }}>{fmtDuration(info.eta)}</div></div>
              </div>
              {!tour.hasElevation && <div className="banner" style={{ marginBottom: 10 }}>Diese Fahrt hat keine Höhendaten — die Strecke wird flach gefahren.</div>}
              <TourMap tour={tour} height={260} />
              <div style={{ marginTop: 10 }}><ElevationProfile tour={tour} height={90} /></div>

              <div className="row wrap" style={{ marginTop: 14, gap: 10 }}>
                <button className={`btn small${mode === 'sim' ? ' primary' : ''}`} onClick={() => setMode('sim')}>🏔 Simulation</button>
                <button className={`btn small${mode === 'erg' ? ' primary' : ''}`} onClick={() => setMode('erg')}>⚡ Feste Leistung (ERG)</button>
              </div>
              {mode === 'sim' && (
                <div className="row" style={{ marginTop: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 200 }}>Schwierigkeit: <b style={{ color: 'var(--text)' }}>{Math.round(difficulty * 100)} %</b> der echten Steigung</span>
                  <input type="range" min={0} max={100} step={5} value={Math.round(difficulty * 100)} onChange={e => setDiff(Number(e.target.value) / 100)} />
                </div>
              )}
              <div className="hint" style={{ marginTop: 8 }}>
                {mode === 'sim'
                  ? 'Der Widerstand folgt der Steigung der Strecke, deine Watt bestimmen die Geschwindigkeit. Während der Fahrt kannst du die Schwierigkeit jederzeit ändern.'
                  : 'Feste Leistung wie im Workout; der Punkt folgt deiner Geschwindigkeit. Die Steigung wird nicht am Trainer simuliert.'}
              </div>

              <div className="row wrap" style={{ marginTop: 14 }}>
                <ConnectButtons />
                <div style={{ flex: 1 }} />
                <button className="btn primary big" disabled={!trainerReady}
                  title={trainerReady ? '' : 'Zuerst Trainer verbinden'}
                  onClick={() => startTour(tour, { mode, difficulty })}>▶ Tour starten</button>
              </div>
              {!trainerReady && <div className="hint" style={{ marginTop: 8 }}>Verbinde zuerst den Kickr (oder den Simulator zum Testen).</div>}
            </>
          )}
        </div>
      )}

      <div className="row wrap" style={{ marginBottom: 12, gap: 10 }}>
        <input type="text" placeholder="Suchen …" value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE) }} style={{ maxWidth: 260 }} />
        <span className="hint">Sortieren:</span>
        {(['date', 'distance', 'ascent'] as Sort[]).map(s => (
          <button key={s} className={`btn small${sort === s ? ' primary' : ''}`} onClick={() => setSort(s)}>
            {s === 'date' ? 'Datum' : s === 'distance' ? 'Distanz' : 'Höhenmeter'}
          </button>
        ))}
      </div>

      {candidates.length === 0 && (
        <div className="card hint">
          Keine Strecken gefunden. Touren entstehen aus deinen Strava-Outdoor-Fahrten mit GPS — importiere sie im Verlauf
          („Strava importieren“) und lade danach unter Einstellungen → Strava „Kurven &amp; GPS nachladen“.
        </div>
      )}

      {candidates.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead><tr><th>Datum</th><th>Name</th><th>Distanz</th><th>Höhenmeter</th><th>Dauer</th></tr></thead>
            <tbody>
              {candidates.slice(0, shown).map(s => (
                <tr key={s.id} className="clickable" style={selected?.id === s.id ? { background: 'rgba(62,207,142,0.08)' } : undefined} onClick={() => setSelected(s)}>
                  <td>{fmtDate(s.startedAt)}</td>
                  <td>{s.name}</td>
                  <td>{((s.distanceM || 0) / 1000).toFixed(1)} km</td>
                  <td>{s.elevationGainM != null ? Math.round(s.elevationGainM) + ' m' : '–'}</td>
                  <td>{fmtDuration(s.durationSec)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length > shown && (
            <div style={{ padding: 12 }}><button className="btn small" onClick={() => setShown(shown + PAGE)}>Mehr anzeigen ({candidates.length - shown} weitere)</button></div>
          )}
        </div>
      )}
    </div>
  )
}
