import { useMemo, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge, type Session, type SessionMeta } from '../bridge'
import { fmtDuration } from '../engine/model'
import SummaryView from '../components/SummaryView'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// Woche -> aufsummierter Wert (TSS fürs Rad, km fürs Laufen), jeweils letzte 8 Wochen.
function useWeeklyAgg(sessions: SessionMeta[], valueFn: (s: SessionMeta) => number) {
  return useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) {
      const w = isoWeek(new Date(s.startedAt))
      map.set(w, (map.get(w) || 0) + valueFn(s))
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8)
  }, [sessions])
}

type Tab = 'bike' | 'run'

export default function HistoryPage() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('bike')
  const [detail, setDetail] = useState<Session | null>(null)
  const [importing, setImporting] = useState(false)
  const stravaReady = !!app.settings?.strava.refreshToken

  const bikeSessions = useMemo(() => app.sessions.filter(s => s.sport !== 'run'), [app.sessions])
  const runSessions = useMemo(() => app.sessions.filter(s => s.sport === 'run'), [app.sessions])
  const active = tab === 'bike' ? bikeSessions : runSessions

  const weeks = useWeeklyAgg(active, tab === 'bike' ? s => s.summary?.tss || 0 : s => (s.distanceM || 0) / 1000)
  const maxVal = Math.max(1, ...weeks.map(([, v]) => v))

  const importActivities = async () => {
    setImporting(true)
    const r = await bridge.stravaImportActivities()
    if (r.ok) {
      showToast(r.imported ? `${r.imported} Einheit(en) von Strava importiert — lade Kurven nach …` : 'Keine neuen Strava-Aktivitäten gefunden.')
      setState({ sessions: await bridge.listSessions() })
      // Nur für neu Importierte: Sekundenwerte sind pro Einheit eine eigene, gedrosselte Anfrage,
      // deshalb separat danach statt im Import selbst (verzögert die Rückmeldung sonst unnötig).
      if (r.imported) {
        const b = await bridge.stravaBackfillStreams()
        if (b.ok) showToast(`Kurven für ${b.done} Einheit(en) geladen ✓`)
        setState({ sessions: await bridge.listSessions() })
      }
    } else showToast(r.error || 'Import fehlgeschlagen', 'err')
    setImporting(false)
  }

  if (detail) return <SessionDetail session={detail} onClose={() => setDetail(null)} />

  return (
    <div>
      <div className="page-title">
        Verlauf <span className="sub">{app.sessions.length} Einheiten</span>
        <div style={{ flex: 1 }} />
        {stravaReady && <button className="btn small" disabled={importing} onClick={importActivities}>{importing ? 'Importiere …' : '🔄 Strava importieren'}</button>}
      </div>

      <div className="row" style={{ marginBottom: 16, gap: 8 }}>
        <button className={`btn small${tab === 'bike' ? ' primary' : ''}`} onClick={() => setTab('bike')}>🚴 Rad <span className="sub">{bikeSessions.length}</span></button>
        <button className={`btn small${tab === 'run' ? ' primary' : ''}`} onClick={() => setTab('run')}>🏃 Laufen <span className="sub">{runSessions.length}</span></button>
      </div>

      {weeks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>{tab === 'bike' ? 'Trainingslast (TSS pro Woche)' : 'Distanz pro Woche (km)'}</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 110 }}>
            {[...weeks].reverse().map(([week, v]) => (
              <div key={week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(v)}</span>
                <div style={{ width: '100%', maxWidth: 46, height: Math.max(4, (v / maxVal) * 70), background: 'var(--accent-dim)', borderRadius: 4 }} />
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{week.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length === 0 && (
        <div className="card hint">
          {tab === 'bike' ? 'Noch keine Rad-Einheiten. Nach dem ersten Workout erscheint hier dein Verlauf.' : 'Noch keine Lauf-Einheiten. Über "🔄 Strava importieren" oben holst du sie aus Strava.'}
        </div>
      )}

      {active.length > 0 && tab === 'bike' && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead><tr>
              <th>Datum</th><th>Workout</th><th>Dauer</th><th>Ø W / Distanz</th><th>NP / Speed</th><th>IF</th><th>TSS</th><th>Ø HF</th><th>Strava</th><th>Cloud</th><th></th>
            </tr></thead>
            <tbody>
              {active.map(s => <BikeRow key={s.id} meta={s} onOpen={async () => {
                const full = await bridge.getSession(s.id)
                if (full) setDetail(full)
              }} />)}
            </tbody>
          </table>
        </div>
      )}

      {active.length > 0 && tab === 'run' && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead><tr>
              <th>Datum</th><th>Workout</th><th>Dauer</th><th>Distanz</th><th>Ø Pace</th><th>Ø HF</th><th>Strava</th><th></th>
            </tr></thead>
            <tbody>
              {active.map(s => <RunRow key={s.id} meta={s} onOpen={async () => {
                const full = await bridge.getSession(s.id)
                if (full) setDetail(full)
              }} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function DeleteButton({ id }: { id: string }) {
  return (
    <td onClick={e => e.stopPropagation()}>
      <button className="btn small danger" onClick={async () => {
        if (!confirm('Einheit löschen?')) return
        await bridge.deleteSession(id)
        setState({ sessions: await bridge.listSessions() })
      }}>✕</button>
    </td>
  )
}

function BikeRow({ meta, onOpen }: { meta: SessionMeta; onOpen: () => void }) {
  const sum = meta.summary
  const outdoor = meta.source === 'strava'
  // Outdoor-Fahrten ohne Leistungsmesser haben keine sinnvollen Watt-Werte -- dann Distanz/Speed statt Ø W/NP.
  const hasPower = !!sum?.avgPower
  const kmh = !hasPower && meta.distanceM && meta.durationSec ? (meta.distanceM / 1000) / (meta.durationSec / 3600) : null
  return (
    <tr className="clickable" onClick={onOpen}>
      <td>{fmtDate(meta.startedAt)}</td>
      <td>{outdoor ? '🌍 ' : ''}{meta.name}</td>
      <td>{fmtDuration(meta.durationSec)}</td>
      {hasPower ? (
        <>
          <td>{sum!.avgPower}</td>
          <td>{sum!.np}</td>
          <td>{sum!.if?.toFixed(2) ?? '–'}</td>
          <td>{Math.round(sum!.tss)}</td>
        </>
      ) : (
        <>
          <td>{meta.distanceM != null ? (meta.distanceM / 1000).toFixed(1) + ' km' : '–'}</td>
          <td>{kmh ? kmh.toFixed(1) + ' km/h' : '–'}</td>
          <td>–</td>
          <td>–</td>
        </>
      )}
      <td>{sum?.avgHr ?? '–'}</td>
      <td>{meta.stravaActivityId ? '✓' : ''}</td>
      <td title={meta.cloudSyncedAt ? `Synchronisiert ${meta.cloudSyncedAt}` : outdoor ? 'Outdoor-Fahrten werden noch nicht synchronisiert' : 'Noch nicht in der Cloud'}>{meta.cloudSyncedAt ? '☁' : ''}</td>
      <DeleteButton id={meta.id} />
    </tr>
  )
}

function RunRow({ meta, onOpen }: { meta: SessionMeta; onOpen: () => void }) {
  return (
    <tr className="clickable" onClick={onOpen}>
      <td>{fmtDate(meta.startedAt)}</td>
      <td>{meta.name}</td>
      <td>{fmtDuration(meta.durationSec)}</td>
      <td>{meta.distanceM != null ? (meta.distanceM / 1000).toFixed(1) + ' km' : '–'}</td>
      <td>{meta.avgPaceSecPerKm ? fmtPace(meta.avgPaceSecPerKm) : '–'}</td>
      <td>{meta.summary?.avgHr ?? '–'}</td>
      <td>{meta.stravaActivityId ? '✓' : ''}</td>
      <DeleteButton id={meta.id} />
    </tr>
  )
}

function SessionDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const app = useApp()
  const [uploading, setUploading] = useState(false)
  const [activityId, setActivityId] = useState(session.stravaActivityId ?? null)
  const stravaReady = !!app.settings?.strava.refreshToken
  const isRun = session.sport === 'run'
  const imported = session.source === 'strava' // von Strava importiert (Lauf oder Outdoor-Fahrt), nicht in der App aufgezeichnet
  const hasPower = !!session.summary?.avgPower

  return (
    <div>
      <div className="page-title">
        <button className="btn small" onClick={onClose}>← Zurück</button>
        {isRun ? '🏃 ' : imported ? '🌍 ' : ''}{session.name} <span className="sub">{fmtDate(session.startedAt)}</span>
      </div>
      {isRun || (imported && !hasPower)
        ? <ImportedSummaryView session={session} />
        : <SummaryView session={session} zones={app.settings!.powerZones} />}
      <div className="row wrap" style={{ marginTop: 16 }}>
        {!imported && <button className="btn primary" disabled={uploading || !stravaReady || activityId != null} onClick={async () => {
          setUploading(true)
          const r = await bridge.stravaUpload(session.id)
          setUploading(false)
          if (r.ok) { setActivityId(r.activityId ?? null); showToast('Bei Strava hochgeladen ✓'); setState({ sessions: await bridge.listSessions() }) }
          else showToast(r.error || 'Upload fehlgeschlagen', 'err')
        }}>{uploading ? 'Lade hoch …' : activityId != null ? '✓ Bei Strava' : '⬆ An Strava senden'}</button>}
        {activityId != null && <button className="btn" onClick={() => bridge.openExternal(`https://www.strava.com/activities/${activityId}`)}>Bei Strava öffnen ↗</button>}
        {!imported && <button className="btn" onClick={async () => {
          const r = await bridge.exportTcx(session.id)
          if (r.ok) showToast('TCX gespeichert: ' + r.filePath)
          else if (!r.canceled) showToast(r.error || 'Export fehlgeschlagen', 'err')
        }}>💾 TCX exportieren</button>}
      </div>
    </div>
  )
}

// Für importierte Einheiten ohne verlässliche Sekundenwerte (Läufe, Outdoor-Fahrten ohne Leistungsmesser) --
// zeigt nur, was tatsächlich vorliegt, statt rad-spezifische Kennzahlen wie NP/TSS/FTP-Zonen vorzutäuschen.
function ImportedSummaryView({ session }: { session: Session }) {
  const s = session.summary
  const isRun = session.sport === 'run'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tile-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat label="Dauer" value={fmtDuration(session.durationSec)} />
        <Stat label="Distanz" value={session.distanceM != null ? (session.distanceM / 1000).toFixed(2) : '–'} unit="km" />
        {isRun
          ? <Stat label="Ø Pace" value={session.avgPaceSecPerKm ? fmtPace(session.avgPaceSecPerKm) : '–'} />
          : <Stat label="Ø Speed" value={session.distanceM && session.durationSec ? ((session.distanceM / 1000) / (session.durationSec / 3600)).toFixed(1) : '–'} unit="km/h" />}
        {session.elevationGainM != null && <Stat label="Höhenmeter" value={Math.round(session.elevationGainM)} unit="m" />}
        {s.avgHr != null && <Stat label="Ø HF" value={s.avgHr} unit="bpm" />}
        {s.maxHr != null && <Stat label="Max HF" value={s.maxHr} unit="bpm" />}
      </div>
      <div className="card hint">Von Strava importiert — keine Sekundenwerte, daher kein Kurvenverlauf.</div>
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 28 }}>{value}{unit && <span className="unit">{unit}</span>}</div>
    </div>
  )
}
