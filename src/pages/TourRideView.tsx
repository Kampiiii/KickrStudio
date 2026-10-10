// Fahransicht einer Tour: Karte mit wanderndem Punkt, Höhenprofil, Live-Werte, Modus-Umschalter
// (Simulation = Widerstand folgt der Steigung / ERG = feste Leistung) und Schwierigkeits-Regler.
import { useApp } from '../state'
import { pauseWorkout, resumeWorkout, setTourMode, setTourDifficulty, setTourErgTarget, setTourFollow } from '../engine/player'
import { fmtDuration, zoneColor } from '../engine/model'
import TourMap from '../components/TourMap'
import ElevationProfile, { gradeColor } from '../components/ElevationProfile'
import EndButton from '../components/EndButton'

function smoothPower(samples: { power: number }[], current: number | null, windowSec: number): number | null {
  if (current == null) return null
  const vals = samples.slice(-Math.max(1, windowSec - 1)).map(s => s.power)
  vals.push(current)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

export default function TourRideView() {
  const app = useApp()
  const { player: p, settings, telemetry } = app
  const tr = p.tour!
  const tour = tr.tour
  const ftp = settings!.ftp
  const displayPower = smoothPower(p.samples, telemetry.power, settings!.erg.smoothingSec)
  const pctOfFtp = displayPower != null ? (displayPower / ftp) * 100 : 0
  const hrPct = telemetry.hr != null ? (telemetry.hr / settings!.hrMax) * 100 : null
  const restKm = Math.max(0, (tour.distanceM - tr.distM) / 1000)
  const avgKmh = p.elapsed > 0 ? (tr.distM / p.elapsed) * 3.6 : 0
  const eta = avgKmh > 1 ? Math.round((restKm / avgKmh) * 3600) : null

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
          <b>🗺️ {tour.name}</b>
          <span className="hint">{(tr.distM / 1000).toFixed(1)} / {(tour.distanceM / 1000).toFixed(1)} km · {fmtDuration(p.elapsed)}</span>
        </div>
        <TourMap tour={tour} distM={tr.distM} follow={tr.follow} height={300} />
        <div style={{ marginTop: 10 }}>
          <ElevationProfile tour={tour} distM={tr.distM} height={90} />
        </div>
      </div>

      <div className="tile-grid" style={{ marginBottom: 14 }}>
        <div className="tile hero">
          <div className="zonebar" style={{ background: zoneColor(pctOfFtp, settings!.powerZones) }} />
          <div className="label">Leistung ({settings!.erg.smoothingSec}s)</div>
          <div className="value">{displayPower ?? '–'}<span className="unit">W</span></div>
          <div className="sub">{Math.round(pctOfFtp)} % FTP{tr.mode === 'erg' ? ` · Ziel ${tr.ergTarget} W` : ''}</div>
        </div>
        <div className="tile">
          <div className="label">Geschwindigkeit</div>
          <div className="value">{(tr.speedMs * 3.6).toFixed(1)}<span className="unit">km/h</span></div>
          <div className="sub">Ø {avgKmh.toFixed(1)} km/h</div>
        </div>
        <div className="tile">
          <div className="zonebar" style={{ background: gradeColor(tr.gradeEff) }} />
          <div className="label">Steigung am Trainer</div>
          <div className="value">{tr.gradeEff.toFixed(1)}<span className="unit">%</span></div>
          <div className="sub">Strecke {tr.gradeReal.toFixed(1)} % · {Math.round(tr.difficulty * 100)} %</div>
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
          <div className="label">Gefahren</div>
          <div className="value" style={{ fontSize: 30 }}>{(tr.distM / 1000).toFixed(1)}<span className="unit">km</span></div>
          <div className="sub">von {(tour.distanceM / 1000).toFixed(1)} km · {Math.round((tr.distM / tour.distanceM) * 100)} %</div>
        </div>
        <div className="tile">
          <div className="label">Noch</div>
          <div className="value" style={{ fontSize: 30 }}>{restKm.toFixed(1)}<span className="unit">km</span></div>
          <div className="sub">{eta != null ? `ca. ${fmtDuration(eta)} bei Ø-Tempo` : '—'}</div>
        </div>
        {telemetry.resistanceLevel != null && (
          <div className="tile">
            <div className="label">Widerstandsstufe</div>
            <div className="value" style={{ fontSize: 30 }}>{telemetry.resistanceLevel}</div>
            <div className="sub">vom Trainer gemeldet</div>
          </div>
        )}
        <div className="tile">
          <div className="label">Höhenmeter</div>
          <div className="value" style={{ fontSize: 30 }}>{Math.round(tr.ascentDoneM)}<span className="unit">m</span></div>
          <div className="sub">von {tour.ascentM} m</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <button className={`btn small${tr.mode === 'sim' ? ' primary' : ''}`} onClick={() => setTourMode('sim')}>🏔 Simulation</button>
            <button className={`btn small${tr.mode === 'erg' ? ' primary' : ''}`} onClick={() => setTourMode('erg')}>⚡ Feste Leistung (ERG)</button>
          </div>
          <button className={`btn small${tr.follow ? ' primary' : ''}`}
            title="Übersicht: die ganze Strecke ist zu sehen, der Punkt wandert darüber. Folgen: die Karte zoomt näher heran und bleibt immer auf dem Punkt."
            onClick={() => setTourFollow(!tr.follow)}>
            {tr.follow ? '📍 Karte folgt dem Punkt' : '🗺 Ganze Strecke'}
          </button>
        </div>
        {tr.mode === 'sim' ? (
          <div className="row" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 170 }}>Schwierigkeit: <b style={{ color: 'var(--text)' }}>{Math.round(tr.difficulty * 100)} %</b> der echten Steigung</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(tr.difficulty * 100)} onChange={e => setTourDifficulty(Number(e.target.value) / 100)} />
          </div>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-dim)', minWidth: 170 }}>ERG-Zielwert: <b style={{ color: 'var(--text)' }}>{tr.ergTarget} W</b></span>
            <input type="range" min={50} max={Math.max(400, Math.round(ftp * 1.8))} step={5} value={tr.ergTarget} onChange={e => setTourErgTarget(Number(e.target.value))} />
            <button className="btn small" onClick={() => setTourErgTarget(tr.ergTarget - 10)}>−10</button>
            <button className="btn small" onClick={() => setTourErgTarget(tr.ergTarget + 10)}>+10</button>
          </div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          {tr.mode === 'sim'
            ? 'Der Widerstand folgt der Steigung der Strecke, deine Watt bestimmen die Geschwindigkeit.'
            : 'Feste Leistung wie im Workout; der Punkt auf der Karte folgt trotzdem deiner Geschwindigkeit.'}
          {' '}Kartenansicht: „Ganze Strecke“ zeigt die komplette Tour, „Karte folgt dem Punkt“ zoomt näher heran und bleibt auf dir.
        </div>
      </div>

      <div className="row wrap">
        {p.status === 'riding'
          ? <button className="btn big" onClick={() => pauseWorkout(false)}>⏸ Pause</button>
          : <button className="btn primary big" onClick={resumeWorkout}>▶ Weiter</button>}
        <div style={{ flex: 1 }} />
        <EndButton />
      </div>
    </div>
  )
}
