// Wiederverwendbare Session-Zusammenfassung: Kennzahlen, Kurven, Zonenverteilung.
import type { Session } from '../bridge'
import type { PowerZone } from '../engine/model'
import { fmtDuration } from '../engine/model'
import SessionChart from './SessionChart'
import ZoneDist from './ZoneDist'

function Stat({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 28 }}>{value}{unit && <span className="unit">{unit}</span>}</div>
    </div>
  )
}

export default function SummaryView({ session, zones }: { session: Session; zones: PowerZone[] }) {
  const s = session.summary
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tile-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <Stat label="Dauer" value={fmtDuration(session.durationSec)} />
        <Stat label="Ø Leistung" value={s.avgPower} unit="W" />
        <Stat label="NP" value={s.np} unit="W" />
        <Stat label="IF" value={s.if.toFixed(2)} />
        <Stat label="TSS" value={Math.round(s.tss)} />
        <Stat label="Arbeit" value={s.kj} unit="kJ" />
        {s.avgHr != null && <Stat label="Ø HF" value={s.avgHr} unit="bpm" />}
        {s.avgCadence != null && <Stat label="Ø Kadenz" value={s.avgCadence} unit="rpm" />}
      </div>
      {session.samples && session.samples.length > 1 && (
        <div className="card"><SessionChart samples={session.samples} /></div>
      )}
      <div className="card">
        <h3 style={{ fontSize: 14, marginBottom: 12 }}>Zeit in Zonen (FTP {session.ftpAtTime} W)</h3>
        <ZoneDist zones={zones} zoneSeconds={s.zoneSeconds} />
      </div>
    </div>
  )
}
