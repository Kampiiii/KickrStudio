import { useEffect, useState } from 'react'
import { useApp, setState, showToast } from '../state'
import { bridge, isElectron, type Settings } from '../bridge'
import { runCloudSync } from '../engine/cloudSync'

export default function SettingsPage() {
  const app = useApp()
  const [s, setS] = useState<Settings | null>(app.settings)
  const [info, setInfo] = useState<{ dataDir: string; mcpServerPath: string; nodeHint: string } | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [withingsConnecting, setWithingsConnecting] = useState(false)

  useEffect(() => { bridge.appInfo().then(setInfo) }, [])
  useEffect(() => { setS(app.settings) }, [app.settings])

  if (!s) return null

  const save = async (next: Settings) => {
    setS(next)
    const saved = await bridge.setSettings(next)
    setState({ settings: saved })
  }

  const upd = (patch: Partial<Settings>) => save({ ...s, ...patch })

  const setFtp = (ftp: number) => {
    if (!ftp || ftp < 50 || ftp > 600) return
    if (ftp !== s.ftp) {
      save({ ...s, ftp, ftpHistory: [...s.ftpHistory, { date: new Date().toISOString().slice(0, 10), ftp }] })
    }
  }

  const stravaConnect = async () => {
    await save(s) // Client-ID/Secret erst persistieren
    setConnecting(true)
    const r = await bridge.stravaConnect()
    setConnecting(false)
    if (r.ok) {
      showToast(`Mit Strava verbunden${r.athleteName ? `: ${r.athleteName}` : ''} ✓`)
      setState({ settings: await bridge.getSettings() })
    } else showToast(r.error || 'Verbindung fehlgeschlagen', 'err')
  }

  const withingsConnect = async () => {
    await save(s)
    setWithingsConnecting(true)
    const r = await bridge.withingsConnect()
    setWithingsConnecting(false)
    if (r.ok) {
      showToast('Mit Withings verbunden ✓ — synchronisiere Waagendaten …')
      setState({ settings: await bridge.getSettings() })
      const sync = await bridge.withingsSync()
      if (sync.ok) showToast(`Withings: ${sync.count} Messungen übernommen.`)
      setState({ settings: await bridge.getSettings() })
    } else showToast(r.error || 'Verbindung fehlgeschlagen', 'err')
  }

  const mcpSnippet = info ? JSON.stringify({
    mcpServers: {
      'kickr-studio': { command: 'node', args: [info.mcpServerPath] },
    },
  }, null, 2) : ''

  return (
    <div>
      <div className="page-title">Einstellungen</div>
      <div className="settings-grid">

        <div className="card settings-section">
          <h3>🏋️ Leistungsprofil</h3>
          <div className="fields">
            <label className="field">FTP (Watt)
              <input type="number" defaultValue={s.ftp} key={s.ftp} onBlur={e => setFtp(Number(e.target.value))} />
            </label>
            <label className="field">Gewicht (kg)
              <input type="number" value={s.weightKg} onChange={e => upd({ weightKg: Number(e.target.value) })} />
            </label>
            <label className="field">Größe (cm)
              <input type="number" value={s.heightCm ?? ''} placeholder="z.B. 182"
                onChange={e => upd({ heightCm: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="field">Geburtsjahr
              <input type="number" value={s.birthYear ?? ''} placeholder="z.B. 1978"
                onChange={e => upd({ birthYear: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="field">HF max (bpm)
              <input type="number" value={s.hrMax} onChange={e => upd({ hrMax: Number(e.target.value) })} />
            </label>
            <label className="field">HF Ruhe (bpm)
              <input type="number" value={s.hrRest} onChange={e => upd({ hrRest: Number(e.target.value) })} />
            </label>
            <div className="full hint">
              {s.weightKg > 0 && <>Aktuell {(s.ftp / s.weightKg).toFixed(2)} W/kg. </>}
              {s.birthYear && <>Alter {new Date().getFullYear() - s.birthYear} — grobe HFmax-Faustformel: {220 - (new Date().getFullYear() - s.birthYear)} bpm. </>}
              Alle Programme sind in %FTP definiert — eine FTP-Änderung skaliert automatisch jedes Workout.
              {s.ftpHistory.length > 0 && <> Verlauf: {s.ftpHistory.slice(-5).map(h => `${h.ftp} W (${h.date})`).join(' · ')}</>}
            </div>
          </div>
        </div>

        <div className="card settings-section">
          <h3>⚡ ERG & Anzeige</h3>
          <div className="fields">
            <label className="field">Leistungsglättung (s)
              <select value={s.erg.smoothingSec} onChange={e => upd({ erg: { ...s.erg, smoothingSec: Number(e.target.value) } })}>
                {[1, 3, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field">Trim-Schrittweite (%)
              <select value={s.erg.trimStepPct} onChange={e => upd({ erg: { ...s.erg, trimStepPct: Number(e.target.value) } })}>
                {[1, 2, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="field">ERG-Sollwert wiederholen (s)
              <select value={s.erg.resendIntervalSec} onChange={e => upd({ erg: { ...s.erg, resendIntervalSec: Number(e.target.value) } })}>
                {[5, 10, 20, 30].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <div className="full hint">Der Zielwert wird periodisch erneut gesendet, damit ein verpasster Befehl den ERG-Modus nicht aus dem Tritt bringt.</div>
          </div>
        </div>

        <div className="card settings-section">
          <h3>🟠 Strava</h3>
          <div className="fields">
            <label className="field">Client-ID
              <input type="text" value={s.strava.clientId} onChange={e => upd({ strava: { ...s.strava, clientId: e.target.value.trim() } })} />
            </label>
            <label className="field">Client-Secret
              <input type="password" value={s.strava.clientSecret} onChange={e => upd({ strava: { ...s.strava, clientSecret: e.target.value.trim() } })} />
            </label>
            <div className="full row">
              {s.strava.refreshToken
                ? <>
                    <span style={{ color: 'var(--accent)' }}>✓ Verbunden{s.strava.athleteName ? ` als ${s.strava.athleteName}` : ''}</span>
                    <button className="btn small" onClick={async () => { await bridge.stravaDisconnect(); setState({ settings: await bridge.getSettings() }) }}>Trennen</button>
                  </>
                : <button className="btn primary" disabled={connecting || !s.strava.clientId || !s.strava.clientSecret} onClick={stravaConnect}>
                    {connecting ? 'Warte auf Strava …' : 'Mit Strava verbinden'}
                  </button>}
            </div>
            <div className="full hint">
              Einmalig nötig: Unter <a style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={() => bridge.openExternal('https://www.strava.com/settings/api')}>strava.com/settings/api</a> eine
              App anlegen („Autorisierungs-Callback-Domain“: <b>localhost</b>), dann Client-ID und Secret hier eintragen und verbinden.
            </div>
          </div>
        </div>

        <div className="card settings-section">
          <h3>⚖️ Withings-Waage</h3>
          <div className="fields">
            <label className="field">Client-ID
              <input type="text" value={s.withings.clientId} onChange={e => upd({ withings: { ...s.withings, clientId: e.target.value.trim() } })} />
            </label>
            <label className="field">Client-Secret
              <input type="password" value={s.withings.clientSecret} onChange={e => upd({ withings: { ...s.withings, clientSecret: e.target.value.trim() } })} />
            </label>
            <div className="full row">
              {s.withings.refreshToken
                ? <>
                    <span style={{ color: 'var(--accent)' }}>✓ Verbunden</span>
                    <button className="btn small" onClick={async () => { await bridge.withingsDisconnect(); setState({ settings: await bridge.getSettings() }) }}>Trennen</button>
                  </>
                : <button className="btn primary" disabled={withingsConnecting || !s.withings.clientId || !s.withings.clientSecret} onClick={withingsConnect}>
                    {withingsConnecting ? 'Warte auf Withings …' : 'Mit Withings verbinden'}
                  </button>}
            </div>
            <label className="full row" style={{ gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={s.withings.autoWeight} style={{ width: 'auto' }}
                onChange={e => upd({ withings: { ...s.withings, autoWeight: e.target.checked } })} />
              Gewicht automatisch von der Waage ins Leistungsprofil übernehmen
            </label>
            <div className="full hint">
              Einmalig nötig: Unter <a style={{ color: 'var(--blue)', cursor: 'pointer' }} onClick={() => bridge.openExternal('https://developer.withings.com/dashboard/')}>developer.withings.com</a> eine
              App anlegen (Callback-URL: <b>http://localhost:{s.httpPort}/withings/callback</b>), dann Client-ID und Secret hier eintragen und verbinden.
              Die Waagendaten erscheinen unter „Körper“ und werden bei jedem App-Start synchronisiert.
            </div>
          </div>
        </div>

        <CloudSection s={s} upd={upd} />

        <div className="card settings-section">
          <h3>✨ Claude / MCP-Schnittstelle</h3>
          <div className="hint" style={{ marginBottom: 10 }}>
            Damit Claude Desktop deine Trainingsdaten auswerten und Workouts vorschlagen kann, trage diesen Block in die
            Claude-Desktop-Konfiguration ein (Datei <span className="kbd">claude_desktop_config.json</span> unter Einstellungen → Entwickler):
          </div>
          <pre className="snippet">{isElectron ? mcpSnippet : 'Nur in der Desktop-App verfügbar.'}</pre>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={() => { navigator.clipboard.writeText(mcpSnippet); showToast('In Zwischenablage kopiert.') }}>Kopieren</button>
            <button className="btn small" onClick={() => bridge.openDataDir()}>Datenordner öffnen</button>
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            Voraussetzung: Node.js ist installiert. Claude kann dann u.a. <i>get_training_load</i>, <i>list_sessions</i>, <i>create_workout</i> und <i>queue_workout</i> nutzen —
            vorgeschlagene Workouts erscheinen oben auf der Trainingsseite.
          </div>
        </div>

        <div className="card settings-section">
          <h3>📶 Geräte</h3>
          <div className="hint">
            Zuletzt verbunden:<br />
            Trainer: <b>{s.devices.trainer?.name || '–'}</b> · HF-Gurt: <b>{s.devices.hr?.name || '–'}</b>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            Verbinden/Trennen direkt auf der Trainingsseite. Der Kickr sollte nicht gleichzeitig mit
            anderen Apps (Wahoo-App, Zwift) verbunden sein — BLE erlaubt nur eine Steuer-Verbindung.
          </div>
        </div>

        <div className="card settings-section">
          <h3>🗂 Daten</h3>
          <div className="hint">
            Speicherort: <span className="kbd" style={{ userSelect: 'text' }}>{info?.dataDir}</span><br /><br />
            Einstellungen, Workouts und alle Einheiten liegen dort als JSON — einfach zu sichern und maschinenlesbar für den MCP-Server.
          </div>
        </div>

        <BackupSection />

      </div>
    </div>
  )
}

function CloudSection({ s, upd }: { s: Settings; upd: (patch: Partial<Settings>) => void }) {
  const [testing, setTesting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const c = s.cloud
  const set = (patch: Partial<Settings['cloud']>) => upd({ cloud: { ...c, ...patch } })

  const test = async () => {
    setTesting(true)
    const r = await bridge.cloudTest()
    setTesting(false)
    if (r.ok) showToast('Google Cloud erreichbar: Bucket und Dataset gefunden ✓')
    else showToast(r.error || 'Verbindungstest fehlgeschlagen', 'err')
  }

  const sync = async () => {
    setSyncing(true)
    await runCloudSync()
    setSyncing(false)
  }

  return (
    <div className="card settings-section">
      <h3>☁️ Google Cloud</h3>
      <div className="fields">
        <label className="field">Projekt-ID
          <input type="text" value={c.projectId} onChange={e => set({ projectId: e.target.value.trim() })} />
        </label>
        <label className="field">Region
          <input type="text" value={c.location} onChange={e => set({ location: e.target.value.trim() })} />
        </label>
        <label className="field">Bucket
          <input type="text" value={c.bucket} onChange={e => set({ bucket: e.target.value.trim() })} />
        </label>
        <label className="field">BigQuery-Dataset
          <input type="text" value={c.dataset} onChange={e => set({ dataset: e.target.value.trim() })} />
        </label>
        <label className="field full">Agent-URL (Cloud Run, für die Coach-Seite)
          <input type="text" value={c.agentUrl} placeholder="https://kickr-coach-…run.app" onChange={e => set({ agentUrl: e.target.value.trim() })} />
        </label>
        <label className="full row" style={{ gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--text-dim)' }}>
          <input type="checkbox" checked={c.autoSync} style={{ width: 'auto' }} onChange={e => set({ autoSync: e.target.checked })} />
          Nach jeder Einheit automatisch in die Cloud synchronisieren
        </label>
        <div className="full row wrap">
          <button className="btn" disabled={testing} onClick={test}>{testing ? 'Teste …' : 'Verbindung testen'}</button>
          <button className="btn primary" disabled={syncing} onClick={sync}>{syncing ? 'Synchronisiere …' : '☁ Jetzt synchronisieren'}</button>
        </div>
        <div className="full hint">
          Die Anmeldung läuft über <span className="kbd">gcloud auth application-default login</span> — es liegen keine Schlüssel in der App.
          Daten werden als JSON in den Bucket geladen, BigQuery wandelt sie in die Iceberg-Tabellen um.
          Aufbau: <span className="kbd">docs/cloud-architecture.md</span>
        </div>
      </div>
    </div>
  )
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function BackupSection() {
  const app = useApp()
  const [autos, setAutos] = useState<{ name: string; sizeBytes: number; mtime: string }[]>([])
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const busy = app.player.status === 'riding' || app.player.status === 'paused'

  useEffect(() => { bridge.listAutoBackups().then(setAutos) }, [])

  const create = async () => {
    setCreating(true)
    const r = await bridge.backupCreate()
    setCreating(false)
    if (r.ok) showToast(`Backup gespeichert (${fmtBytes(r.sizeBytes || 0)}): ${r.filePath}`)
    else if (!r.canceled) showToast(r.error || 'Backup fehlgeschlagen', 'err')
  }

  const restore = async () => {
    setConfirmRestore(false)
    setRestoring(true)
    const r = await bridge.backupRestore()
    setRestoring(false)
    if (r.ok) {
      showToast('Wiederhergestellt — App wird neu gestartet …')
      setTimeout(() => bridge.relaunchApp(), 1200)
    } else if (!r.canceled) showToast(r.error || 'Wiederherstellung fehlgeschlagen', 'err')
  }

  const latest = autos[0]

  return (
    <div className="card settings-section">
      <h3>🗄️ Backup</h3>
      <div className="hint" style={{ marginBottom: 12 }}>
        Bei jedem App-Start wird automatisch ein Backup aller Daten (Einstellungen, Workouts, Verlauf, Körperdaten, Plan)
        neben dem Datenordner abgelegt — die letzten {10} Stände bleiben erhalten. Das schützt vor versehentlichem
        Überschreiben, aber <b>nicht</b> vor Festplattenverlust: exportiere zusätzlich gelegentlich manuell an einen
        anderen Ort (z.B. einen Cloud-Ordner wie OneDrive/Dropbox oder einen USB-Stick).
      </div>
      {latest && <div className="hint" style={{ marginBottom: 12 }}>
        Letztes Auto-Backup: {new Date(latest.mtime).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ({fmtBytes(latest.sizeBytes)}) · {autos.length} gespeichert
      </div>}
      <div className="row wrap">
        <button className="btn primary" disabled={creating} onClick={create}>
          {creating ? 'Erstelle …' : '💾 Backup exportieren …'}
        </button>
        {!confirmRestore ? (
          <button className="btn" disabled={restoring || busy} title={busy ? 'Erst Training beenden' : ''}
            onClick={() => setConfirmRestore(true)}>♻ Backup wiederherstellen …</button>
        ) : (
          <>
            <button className="btn danger" disabled={restoring} onClick={restore}>
              {restoring ? 'Stelle wieder her …' : 'Wirklich überschreiben — Datei wählen'}
            </button>
            <button className="btn small" onClick={() => setConfirmRestore(false)}>Abbrechen</button>
          </>
        )}
        <button className="btn small" onClick={() => bridge.openBackupFolder()}>Auto-Backup-Ordner öffnen</button>
      </div>
    </div>
  )
}
