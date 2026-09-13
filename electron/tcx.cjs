// TCX-Export einer Session (Strava-kompatibel: Watt, HF, Trittfrequenz).
// Geschwindigkeit/Distanz werden aus der Leistung geschätzt (virtuelle Fahrt),
// damit Strava eine plausible Strecke anzeigt.

function estimateSpeedMs(watts, totalMassKg) {
  // Löse P = (Crr*m*g + 0.5*rho*CdA*v^2) * v näherungsweise per Newton-Iteration
  if (!watts || watts <= 0) return 0
  const g = 9.81, rho = 1.226, CdA = 0.32, Crr = 0.004
  const roll = Crr * totalMassKg * g
  let v = 7
  for (let i = 0; i < 12; i++) {
    const f = (roll + 0.5 * rho * CdA * v * v) * v - watts
    const df = roll + 1.5 * rho * CdA * v * v
    v = Math.max(0.1, v - f / df)
  }
  return v
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sessionToTcx(session, weightKg = 78) {
  const start = new Date(session.startedAt)
  const totalMass = (weightKg || 78) + 8
  let dist = 0
  const points = []
  for (const s of session.samples || []) {
    const t = new Date(start.getTime() + s.t * 1000).toISOString()
    const v = estimateSpeedMs(s.power, totalMass)
    dist += v
    points.push(
      `<Trackpoint><Time>${t}</Time>` +
      (s.hr ? `<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>` : '') +
      (s.cadence != null ? `<Cadence>${Math.round(s.cadence)}</Cadence>` : '') +
      `<DistanceMeters>${dist.toFixed(1)}</DistanceMeters>` +
      `<Extensions><ns3:TPX><ns3:Speed>${v.toFixed(2)}</ns3:Speed><ns3:Watts>${Math.round(s.power || 0)}</ns3:Watts></ns3:TPX></Extensions>` +
      `</Trackpoint>`
    )
  }
  const sum = session.summary || {}
  const durationSec = session.durationSec || (session.samples ? session.samples.length : 0)
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${start.toISOString()}</Id>
      <Lap StartTime="${start.toISOString()}">
        <TotalTimeSeconds>${durationSec}</TotalTimeSeconds>
        <DistanceMeters>${dist.toFixed(1)}</DistanceMeters>
        <Calories>${Math.round((sum.kj || 0) * 1.05)}</Calories>
        ${sum.avgHr ? `<AverageHeartRateBpm><Value>${Math.round(sum.avgHr)}</Value></AverageHeartRateBpm><MaximumHeartRateBpm><Value>${Math.round(sum.maxHr || sum.avgHr)}</Value></MaximumHeartRateBpm>` : ''}
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          ${points.join('\n          ')}
        </Track>
        <Extensions><ns3:LX><ns3:AvgWatts>${Math.round(sum.avgPower || 0)}</ns3:AvgWatts><ns3:MaxWatts>${Math.round(sum.maxPower || 0)}</ns3:MaxWatts></ns3:LX></Extensions>
      </Lap>
      <Notes>${esc(session.name || 'KickrStudio Workout')}</Notes>
    </Activity>
  </Activities>
  <Author xsi:type="Application_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Name>KickrStudio</Name><Build><Version><VersionMajor>0</VersionMajor><VersionMinor>1</VersionMinor><BuildMajor>0</BuildMajor><BuildMinor>0</BuildMinor></Version></Build><LangID>de</LangID><PartNumber>000-00000-00</PartNumber></Author>
</TrainingCenterDatabase>`
}

module.exports = { sessionToTcx }
