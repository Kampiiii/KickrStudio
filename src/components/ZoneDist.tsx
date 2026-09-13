import type { PowerZone } from '../engine/model'
import { ZONE_COLORS, fmtDuration } from '../engine/model'

export default function ZoneDist({ zones, zoneSeconds }: { zones: PowerZone[]; zoneSeconds: number[] }) {
  const total = Math.max(1, zoneSeconds.reduce((a, b) => a + b, 0))
  return (
    <div className="zone-dist">
      {zones.map((z, i) => {
        const sec = zoneSeconds[i] || 0
        return (
          <div className="zone-row" key={z.name}>
            <span className="zname">{z.name}</span>
            <div className="zbar-track">
              <div className="zbar" style={{ width: `${(sec / total) * 100}%`, background: ZONE_COLORS[i] }} />
            </div>
            <span className="ztime">{fmtDuration(sec)}</span>
          </div>
        )
      })}
    </div>
  )
}
