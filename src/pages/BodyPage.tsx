// Körperzusammensetzung: Withings-Waagendaten (Gewicht, Fett, Muskeln) im Verlauf.
import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useApp, setState, showToast } from '../state'
import { bridge, type BodyEntry } from '../bridge'

export default function BodyPage() {
  const app = useApp()
  const [entries, setEntries] = useState<BodyEntry[] | null>(null)
  const [syncing, setSyncing] = useState(false)
  const connected = !!app.settings?.withings.refreshToken

  const load = () => bridge.listBody().then(setEntries)
  useEffect(() => { load() }, [])

  const sync = async () => {
    setSyncing(true)
    const r = await bridge.withingsSync()
    setSyncing(false)
    if (r.ok) {
      showToast(`Withings synchronisiert: ${r.count} Messungen abgerufen.`)
      load()
      setState({ settings: await bridge.getSettings() })
    } else showToast(r.error || 'Sync fehlgeschlagen', 'err')
  }

  if (entries === null) return null

  const latest = latestValues(entries)
  const s = app.settings!
  const wkg = latest.weightKg && s.ftp ? (s.ftp / latest.weightKg).toFixed(2) : null
  const bmi = latest.weightKg && s.heightCm ? (latest.weightKg / Math.pow(s.heightCm / 100, 2)).toFixed(1) : null
  const d30 = delta(entries, 'weightKg', 30)
  const d30fat = delta(entries, 'fatPct', 30)

  return (
    <div>
      <div className="page-title">Körper
        <span className="sub">{connected ? `Withings verbunden${s.withings.lastSyncAt ? ` · letzter Sync ${new Date(s.withings.lastSyncAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}` : 'Withings nicht verbunden'}</span>
        <div style={{ flex: 1 }} />
        {connected
          ? <button className="btn small" disabled={syncing} onClick={sync}>{syncing ? 'Synchronisiere …' : '↻ Jetzt synchronisieren'}</button>
          : <button className="btn small primary" onClick={() => setState({ page: 'settings' })}>Withings einrichten →</button>}
      </div>

      {entries.length === 0 && (
        <div className="card hint">
          Noch keine Körperdaten. Verbinde deine Withings-Waage in den Einstellungen — danach erscheinen hier Gewicht,
          Fettanteil, Muskelmasse &amp; Co. im Verlauf, und du siehst, wie sich deine Körperzusammensetzung mit dem Training entwickelt.
        </div>
      )}

      {entries.length > 0 && <>
        <div className="tile-grid" style={{ marginBottom: 14 }}>
          <Tile label="Gewicht" value={latest.weightKg?.toFixed(1) ?? '–'} unit="kg"
            sub={d30 != null ? `${d30 > 0 ? '+' : ''}${d30.toFixed(1)} kg in 30 Tagen` : undefined} />
          <Tile label="Körperfett" value={latest.fatPct?.toFixed(1) ?? '–'} unit="%"
            sub={d30fat != null ? `${d30fat > 0 ? '+' : ''}${d30fat.toFixed(1)} %-Pkt. in 30 Tagen` : undefined} />
          <Tile label="Muskelmasse" value={latest.muscleKg?.toFixed(1) ?? '–'} unit="kg" />
          <Tile label="Wasser" value={latest.waterKg?.toFixed(1) ?? '–'} unit="kg" />
          {wkg && <Tile label="Watt pro kg" value={wkg} unit="W/kg" sub={`bei FTP ${s.ftp} W`} />}
          {bmi && <Tile label="BMI" value={bmi} sub={`bei ${s.heightCm} cm`} />}
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>Gewicht &amp; Körperfett</h3>
          <BodyChart entries={entries} />
        </div>
        {entries.some(e => e.muscleKg) && (
          <div className="card">
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Muskelmasse</h3>
            <BodyChart entries={entries} series="muscleKg" />
          </div>
        )}
      </>}
    </div>
  )
}

function Tile({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 32 }}>{value}{unit && <span className="unit">{unit}</span>}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

function latestValues(entries: BodyEntry[]): BodyEntry {
  const out: BodyEntry = { date: '' }
  for (const e of entries) {
    for (const k of ['weightKg', 'fatPct', 'muscleKg', 'waterKg', 'boneKg'] as const) {
      if (e[k] != null) out[k] = e[k]
    }
  }
  return out
}

// Veränderung eines Werts gegenüber der ältesten Messung der letzten `days` Tage
function delta(entries: BodyEntry[], key: 'weightKg' | 'fatPct', days: number): number | null {
  const cutoff = Date.now() - days * 86400000
  const recent = entries.filter(e => e[key] != null && new Date(e.date).getTime() >= cutoff)
  if (recent.length < 2) return null
  return recent[recent.length - 1][key]! - recent[0][key]!
}

function BodyChart({ entries, series = 'weight' }: { entries: BodyEntry[]; series?: 'weight' | 'muscleKg' }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const pts = entries.filter(e => series === 'weight' ? e.weightKg != null || e.fatPct != null : e.muscleKg != null)
    if (pts.length < 2) return
    const t = pts.map(e => new Date(e.date).getTime() / 1000)
    const axisStyle = { stroke: '#8b98a9', grid: { stroke: '#232e3d' }, ticks: { stroke: '#232e3d' } }

    const opts: uPlot.Options = {
      width: ref.current.clientWidth,
      height: 220,
      cursor: { drag: { x: true, y: false } },
      scales: series === 'weight' ? { fat: { range: (_u, min, max) => [Math.floor(min - 1), Math.ceil(max + 1)] } } : {},
      axes: series === 'weight'
        ? [axisStyle, { ...axisStyle, label: 'kg' }, { ...axisStyle, scale: 'fat', side: 1, label: '%' }]
        : [axisStyle, { ...axisStyle, label: 'kg' }],
      series: series === 'weight'
        ? [
            {},
            { label: 'Gewicht (kg)', stroke: '#3ecf8e', width: 2, spanGaps: true, points: { show: true, size: 4 } },
            { label: 'Fett (%)', scale: 'fat', stroke: '#f2903a', width: 1.5, spanGaps: true, points: { show: true, size: 3 } },
          ]
        : [
            {},
            { label: 'Muskelmasse (kg)', stroke: '#3b9dd6', width: 2, spanGaps: true, points: { show: true, size: 4 } },
          ],
      legend: { live: true },
    }
    const data: uPlot.AlignedData = series === 'weight'
      ? [t, pts.map(e => e.weightKg ?? null), pts.map(e => e.fatPct ?? null)]
      : [t, pts.map(e => e.muscleKg ?? null)]
    const plot = new uPlot(opts, data, ref.current)
    const onResize = () => { if (ref.current) plot.setSize({ width: ref.current.clientWidth, height: 220 }) }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); plot.destroy() }
  }, [entries, series])

  return <div ref={ref} style={{ width: '100%' }} />
}
