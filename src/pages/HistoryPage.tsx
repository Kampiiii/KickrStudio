import { useEffect, useMemo, useState } from 'react'
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

export default function HistoryPage() {
  const app = useApp()
  const [detail, setDetail] = useState<Session | null>(null)
  const [importing, setImporting] = useState(false)
  const stravaReady = !!app.settings?.strava.refreshToken

  const importRuns = async () => {
    setImporting(true)
    const r = await bridge.stravaImportRuns()
    setImporting(false)
    if (r.ok) {
      showToast(r.imported ? `${r.imported} Lauf-Einheit(en) importiert ✓` : 'Keine neuen Läufe gefunden.')
      setState({ sessions: await bridge.listSessions() })
    } else showToast(r.error || 'Import fehlgeschlagen', 'err')
  }

  const weeks = useMemo(() => {
    const map = new Map<string, { tss: number; sec: number; count: number }>()
    for (const s of app.sessions) {
      const w = isoWeek(new Date(s.startedAt))
      const e = map.get(w) || { tss: 0, sec: 0, count: 0 }
      e.tss += s.summary?.tss || 0
      e.sec += s.durationSec
      e.count++
      map.set(w, e)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8)
  }, [app.sessions])

  const maxTss = Math.max(1, ...weeks.map(([, w]) => w.tss))

  if (detail) return <SessionDetail session={detail} onClose={() => setDetail(null)} />

  return (
    <div>
      <div className="page-title">
        Verlauf <span className="sub">{app.sessions.length} Einheiten</span>
        <div style={{ flex: 1 }} />
        {stravaReady && <button className="btn small" disabled={importing} onClick={importRuns}>{importing ? 'Importiere …' : '🏃 Läufe von Strava importieren'}</button>}
      </div>

      {weeks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 12 }}>Trainingslast (TSS pro Woche)</h3>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 110 }}>
            {[...weeks].reverse().map(([week, w]) => (
              <div key={week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(w.tss)}</span>
                <div style={{ width: '100%', maxWidth: 46, height: Math.max(4, (w.tss / maxTss) * 70), background: 'var(--accent-dim)', borderRadius: 4 }} />
                <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>{week.slice(5)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {app.sessions.length === 0 && <div className="card hint">Noch keine Einheiten aufgezeichnet. Nach dem ersten Workout erscheint hier dein Verlauf.</div>}

      {app.sessions.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead><tr>
              <th>Datum</th><th>Workout</th><th>Dauer</th><th>Ø W / Distanz</th><th>NP / Pace</th><th>IF</th><th>TSS</th><th>Ø HF</th><th>Strava</th><th>Cloud</th><th></th>
            </tr></thead>
            <tbody>
              {app.sessions.map(s => <HistoryRow key={s.id} meta={s} onOpen={async () => {
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

function HistoryRow({ meta, onOpen }: { meta: SessionMeta; onOpen: () => void }) {
  const sum = meta.summary
  const isRun = meta.sport === 'run'
  return (
    <tr className="clickable" onClick={onOpen}>
      <td>{fmtDate(meta.startedAt)}</td>
      <td>{isRun ? '🏃 ' : ''}{meta.name}</td>
      <td>{fmtDuration(meta.durationSec)}</td>
      {isRun ? (
        <>
          <td>{meta.distanceM != null ? (meta.distanceM / 1000).toFixed(1) + ' km' : '–'}</td>
          <td>{meta.avgPaceSecPerKm ? fmtPace(meta.avgPaceSecPerKm) : '–'}</td>
          <td>–</td>
          <td>–</td>
        </>
      ) : (
        <>
          <td>{sum?.avgPower ?? '–'}</td>
          <td>{sum?.np ?? '–'}</td>
          <td>{sum?.if?.toFixed(2) ?? '–'}</td>
          <td>{sum ? Math.round(sum.tss) : '–'}</td>
        </>
      )}
      <td>{sum?.avgHr ?? '–'}</td>
      <td>{meta.stravaActivityId ? '✓' : ''}</td>
      <td title={meta.cloudSyncedAt ? `Synchronisiert ${meta.cloudSyncedAt}` : isRun ? 'Läufe werden noch nicht synchronisiert' : 'Noch nicht in der Cloud'}>{meta.cloudSyncedAt ? '☁' : ''}</td>
      <td onClick={e => e.stopPropagation()}>
        <button className="btn small danger" onClick={async () => {
          if (!confirm('Einheit löschen?')) return
          await bridge.deleteSession(meta.id)
          setState({ sessions: await bridge.listSessions() })
        }}>✕</button>
      </td>
    </tr>
  )
}

function SessionDetail({ session, onClose }: { session: Session; onClose: () => void }) {
  const app = useApp()
  const [uploading, setUploading] = useState(false)
  const [activityId, setActivityId] = useState(session.stravaActivityId ?? null)
  const stravaReady = !!app.settings?.strava.refreshToken
  const isRun = session.sport === 'run'

  return (
    <div>
      <div className="page-title">
        <button className="btn small" onClick={onClose}>← Zurück</button>
        {isRun ? '🏃 ' : ''}{session.name} <span className="sub">{fmtDate(session.startedAt)}</span>
      </div>
      {isRun ? <RunSummaryView session={session} /> : <SummaryView session={session} zones={app.settings!.powerZones} />}
      <div className="row wrap" style={{ marginTop: 16 }}>
        {!isRun && <button className="btn primary" disabled={uploading || !stravaReady || activityId != null} onClick={async () => {
          setUploading(true)
          const r = await bridge.stravaUpload(session.id)
          setUploading(false)
          if (r.ok) { setActivityId(r.activityId ?? null); showToast('Bei Strava hochgeladen ✓'); setState({ sessions: await bridge.listSessions() }) }
          else showToast(r.error || 'Upload fehlgeschlagen', 'err')
        }}>{uploading ? 'Lade hoch …' : activityId != null ? '✓ Bei Strava' : '⬆ An Strava senden'}</button>}
        {activityId != null && <button className="btn" onClick={() => bridge.openExternal(`https://www.strava.com/activities/${activityId}`)}>Bei Strava öffnen ↗</button>}
        {!isRun && <button className="btn" onClick={async () => {
          const r = await bridge.exportTcx(session.id)
          if (r.ok) showToast('TCX gespeichert: ' + r.filePath)
          else if (!r.canceled) showToast(r.error || 'Export fehlgeschlagen', 'err')
        }}>💾 TCX exportieren</button>}
      </div>
    </div>
  )
}

function RunSummaryView({ session }: { session: Session }) {
  const s = session.summary
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tile-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat label="Dauer" value={fmtDuration(session.durationSec)} />
        <Stat label="Distanz" value={session.distanceM != null ? (session.distanceM / 1000).toFixed(2) : '–'} unit="km" />
        <Stat label="Ø Pace" value={session.avgPaceSecPerKm ? fmtPace(session.avgPaceSecPerKm) : '–'} />
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
