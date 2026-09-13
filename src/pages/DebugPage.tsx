// Debug-/Protokollansicht: zeigt das Start-Protokoll direkt in der App, damit man
// nicht jedes Mal manuell in %APPDATA%\kickr-studio\startup.log nachsehen muss.
import { useEffect, useState } from 'react'
import { bridge } from '../bridge'

interface LogInfo {
  startupLog: string; fallbackLog: string; dataDir: string; logFile: string
  appPath: string; isPackaged: boolean; versions: Record<string, string>
}

export default function DebugPage() {
  const [info, setInfo] = useState<LogInfo | null>(null)
  const [auto, setAuto] = useState(true)

  const load = () => bridge.getDebugLog().then(setInfo)

  useEffect(() => {
    load()
    if (!auto) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [auto])

  if (!info) return null

  return (
    <div>
      <div className="page-title">Debug
        <span className="sub">Start-Protokoll dieser Installation — hilft beim Aufspüren von Ladeproblemen</span>
        <div style={{ flex: 1 }} />
        <label className="row" style={{ gap: 6, fontSize: 12.5, color: 'var(--text-dim)', cursor: 'pointer' }}>
          <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} style={{ width: 'auto' }} />
          Auto-Aktualisierung
        </label>
        <button className="btn small" onClick={load}>↻ Aktualisieren</button>
        <button className="btn small" onClick={() => bridge.openLogFolder()}>Ordner öffnen</button>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="hint" style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 4 }}>
          <span>Datenordner:</span><span style={{ userSelect: 'text' }}>{info.dataDir}</span>
          <span>App-Pfad:</span><span style={{ userSelect: 'text' }}>{info.appPath}</span>
          <span>Gepackt (isPackaged):</span><span>{String(info.isPackaged)}</span>
          <span>Electron / Node / Chrome:</span><span>{info.versions.electron} / {info.versions.node} / {info.versions.chrome}</span>
          <span>Log-Datei:</span><span style={{ userSelect: 'text' }}>{info.logFile}</span>
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 10 }}>startup.log</h3>
        <pre className="snippet" style={{ maxHeight: 420, overflowY: 'auto', userSelect: 'text' }}>
          {info.startupLog || '(leer — noch keine Einträge)'}
        </pre>
      </div>

      {info.fallbackLog && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Fallback-Log (%TEMP%) — regulärer Log-Pfad war nicht beschreibbar</h3>
          <pre className="snippet" style={{ maxHeight: 300, overflowY: 'auto', userSelect: 'text' }}>{info.fallbackLog}</pre>
        </div>
      )}
    </div>
  )
}
