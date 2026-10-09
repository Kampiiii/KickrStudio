// Strava-Integration: OAuth über Systembrowser + localhost-Callback,
// Token-Refresh, TCX-Upload mit Status-Polling.
const http = require('http')
const { shell } = require('electron')
const store = require('./store.cjs')

const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const UPLOAD_URL = 'https://www.strava.com/api/v3/uploads'
const API_URL = 'https://www.strava.com/api/v3'

// Startet einen temporären Callback-Server, öffnet den Browser und wartet auf den OAuth-Code.
function connect() {
  const settings = store.getSettings()
  const { clientId, clientSecret } = settings.strava
  if (!clientId || !clientSecret) return Promise.resolve({ ok: false, error: 'Client-ID und Client-Secret fehlen (Settings → Strava).' })
  const port = settings.httpPort || 4571

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      if (url.pathname !== '/strava/callback') { res.writeHead(404); res.end(); return }
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body style="font-family:sans-serif;background:#0b0f14;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>${err ? 'Strava-Verbindung abgebrochen' : 'Mit Strava verbunden ✓'}</h2><p>Du kannst dieses Fenster schließen und zu KickrStudio zurückkehren.</p></div></body></html>`)
      clearTimeout(timeout)
      server.close()
      if (err || !code) { resolve({ ok: false, error: 'Autorisierung abgebrochen.' }); return }
      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' }),
        })
        const data = await r.json()
        if (!r.ok || !data.access_token) { resolve({ ok: false, error: 'Token-Austausch fehlgeschlagen: ' + JSON.stringify(data) }); return }
        const s = store.getSettings()
        s.strava = {
          ...s.strava,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: data.expires_at,
          athleteName: data.athlete ? `${data.athlete.firstname || ''} ${data.athlete.lastname || ''}`.trim() : '',
        }
        store.saveSettings(s)
        resolve({ ok: true, athleteName: s.strava.athleteName })
      } catch (e) {
        resolve({ ok: false, error: String(e) })
      }
    })
    const timeout = setTimeout(() => { try { server.close() } catch { } resolve({ ok: false, error: 'Zeitüberschreitung – keine Antwort von Strava.' }) }, 180000)
    server.on('error', (e) => { clearTimeout(timeout); resolve({ ok: false, error: `Callback-Port ${port} belegt: ${e.message}` }) })
    server.listen(port, '127.0.0.1', () => {
      const redirect = encodeURIComponent(`http://localhost:${port}/strava/callback`)
      // activity:read_all (statt nur "read") ist nötig, um Aktivitätsdetails zu lesen -- auch eigene
      // private ("Nur ich"-)Aktivitäten, nicht nur öffentliche. approval_prompt=force statt auto:
      // Strava überspringt den Freigabe-Dialog sonst bei einer bereits autorisierten App, selbst wenn
      // sich der angefragte Scope geändert hat -- der erweiterte Zugriff würde dann NICHT erteilt,
      // ohne dass das sichtbar wäre (Fehler zeigt sich erst beim Datenzugriff als 404).
      shell.openExternal(`${AUTH_URL}?client_id=${clientId}&response_type=code&redirect_uri=${redirect}&scope=activity:write,activity:read_all&approval_prompt=force`)
    })
  })
}

async function getFreshToken() {
  const settings = store.getSettings()
  const s = settings.strava
  if (!s.refreshToken) throw new Error('Nicht mit Strava verbunden (Settings → Strava → Verbinden).')
  if (s.expiresAt && s.expiresAt * 1000 > Date.now() + 60000) return s.accessToken
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: s.clientId, client_secret: s.clientSecret, grant_type: 'refresh_token', refresh_token: s.refreshToken }),
  })
  const data = await r.json()
  if (!r.ok || !data.access_token) throw new Error('Token-Refresh fehlgeschlagen: ' + JSON.stringify(data))
  settings.strava = { ...s, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: data.expires_at }
  store.saveSettings(settings)
  return data.access_token
}

async function uploadTcx(tcxString, name, description) {
  const token = await getFreshToken()
  const form = new FormData()
  form.append('file', new Blob([tcxString], { type: 'application/xml' }), 'workout.tcx')
  form.append('data_type', 'tcx')
  form.append('name', name)
  form.append('description', description || '')
  form.append('trainer', '1')
  form.append('activity_type', 'virtualride')
  const r = await fetch(UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
  const data = await r.json()
  if (!r.ok || data.error) throw new Error('Upload fehlgeschlagen: ' + (data.error || JSON.stringify(data)))

  // Verarbeitung abwarten, um die Activity-ID zu bekommen
  for (let i = 0; i < 15; i++) {
    await new Promise(res => setTimeout(res, 2000))
    const st = await fetch(`${UPLOAD_URL}/${data.id}`, { headers: { Authorization: `Bearer ${token}` } })
    const sd = await st.json()
    if (sd.error) throw new Error('Strava-Verarbeitung fehlgeschlagen: ' + sd.error)
    if (sd.activity_id) return { activityId: sd.activity_id }
  }
  return { activityId: null, pending: true }
}

// Strava-Aktivitätstypen -> unser Sport-Feld. Indoor-Kickr-Fahrten sind hier bewusst NICHT
// dabei als eigener Fall -- sie kommen über den App-eigenen Upload in den Verlauf und werden
// unten über die Strava-Activity-ID automatisch übersprungen (keine Dopplung).
const SPORT_BY_TYPE = {
  Run: 'run', TrailRun: 'run', VirtualRun: 'run',
  Ride: 'bike', VirtualRide: 'bike', GravelRide: 'bike', MountainBikeRide: 'bike', EBikeRide: 'bike',
}

// Läuft über die Strava-Aktivitätsliste (neueste zuerst, paginiert) und importiert alle Lauf- und
// Rad-Aktivitäten, die lokal noch nicht als Session vorliegen (Dedupe über die Activity-ID --
// erfasst auch die eigenen Kickr-Uploads, die bereits lokal existieren, und lässt sie unangetastet).
async function importActivities() {
  const token = await getFreshToken()
  const settings = store.getSettings()
  const existing = new Set(
    store.listSessions().map(s => s.stravaActivityId).filter(Boolean)
  )
  let imported = 0, skipped = 0, page = 1

  while (true) {
    const r = await fetch(`${API_URL}/athlete/activities?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) throw new Error(`Strava-Abfrage fehlgeschlagen (HTTP ${r.status}): ${(await r.text()).slice(0, 300)}`)
    const activities = await r.json()
    if (!Array.isArray(activities) || activities.length === 0) break

    for (const a of activities) {
      const sport = SPORT_BY_TYPE[a.type] || SPORT_BY_TYPE[a.sport_type]
      if (!sport) continue
      if (existing.has(a.id)) { skipped++; continue }

      // Rad: wenn ein Leistungsmesser Daten geliefert hat, grobe IF/TSS gegen die aktuelle FTP
      // schätzen (Strava liefert nur Zusammenfassungen, keine Sekundenwerte -- daher nur eine Näherung).
      const np = sport === 'bike' ? (a.weighted_average_watts || a.average_watts || 0) : 0
      const ifVal = settings.ftp && np ? np / settings.ftp : 0
      const tss = settings.ftp && np ? (a.moving_time / 3600) * ifVal * ifVal * 100 : 0

      store.saveSession({
        id: 'strava-' + a.id,
        name: a.name || (sport === 'run' ? 'Lauf' : 'Fahrt'),
        startedAt: a.start_date,
        durationSec: a.moving_time,
        sport,
        distanceM: a.distance,
        elevationGainM: a.total_elevation_gain ?? null,
        avgPaceSecPerKm: sport === 'run' && a.average_speed ? Math.round(1000 / a.average_speed) : null,
        ftpAtTime: sport === 'bike' ? settings.ftp : 0,
        summary: {
          avgPower: a.average_watts ?? 0, maxPower: a.max_watts ?? 0, np, if: Math.round(ifVal * 100) / 100,
          tss: Math.round(tss * 10) / 10, kj: a.kilojoules ?? 0,
          avgHr: a.average_heartrate ?? null, maxHr: a.max_heartrate ?? null,
          avgCadence: a.average_cadence ?? null, zoneSeconds: [], best60s: 0,
        },
        stravaActivityId: a.id,
        source: 'strava',
        samples: [],
      })
      existing.add(a.id)
      imported++
    }
    if (activities.length < 100) break
    page++
    if (page > 20) break // Sicherheitsgrenze (2000 Aktivitäten) gegen Endlosschleifen
  }
  return { ok: true, imported, skipped }
}

const STREAM_KEYS = 'time,heartrate,watts,cadence,velocity_smooth,distance,altitude,latlng'
const GPS_ONLY_KEYS = 'time,latlng' // für Einheiten, deren Kurven schon da sind und nur GPS fehlt

// Sekundenwerte einer Aktivität holen. 404 heißt: keine Streams vorhanden (z.B. manueller Eintrag) --
// kein Fehler, einfach keine Kurve. Bei 429 (Rate-Limit trotz Drosselung) einmal nach Retry-After warten.
async function fetchStreams(token, activityId, keys = STREAM_KEYS) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${API_URL}/activities/${activityId}/streams?keys=${keys}&key_by_type=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (r.status === 404) return null
    if (r.status === 429) {
      const wait = (Number(r.headers.get('Retry-After')) || 900) * 1000
      await new Promise(res => setTimeout(res, wait))
      continue
    }
    if (!r.ok) throw new Error(`Streams-Abfrage fehlgeschlagen (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }
  throw new Error('Weiterhin Rate-Limit nach Wartezeit.')
}

function streamsToSamples(streams) {
  const time = streams?.time?.data || []
  if (time.length === 0) return []
  const hr = streams.heartrate?.data, watts = streams.watts?.data, cad = streams.cadence?.data
  const vel = streams.velocity_smooth?.data, dist = streams.distance?.data, alt = streams.altitude?.data
  const ll = streams.latlng?.data
  return time.map((t, i) => ({
    t,
    power: watts?.[i] ?? 0,
    hr: hr?.[i] ?? null,
    cadence: cad?.[i] ?? null,
    target: 0,
    paceSecPerKm: vel?.[i] ? Math.round(1000 / vel[i]) : null,
    distanceM: dist?.[i] ?? null,
    altitudeM: alt?.[i] ?? null,
    ...gpsFields(ll?.[i]),
  }))
}

// [lat, lng] -> Felder; 5 Nachkommastellen (~1 m) reichen und halten die Dateien klein.
function gpsFields(pair) {
  return Array.isArray(pair) && pair.length === 2
    ? { lat: Math.round(pair[0] * 1e5) / 1e5, lng: Math.round(pair[1] * 1e5) / 1e5 }
    : {}
}

// Ergänzt vorhandene Sekundenwerte um GPS (Zuordnung über die Zeit t, nicht über die Position im Array).
function mergeGps(samples, streams) {
  const time = streams?.time?.data || [], ll = streams?.latlng?.data
  if (!ll || !time.length) return { samples, gotGps: false }
  const idx = new Map(time.map((t, i) => [t, i]))
  let n = 0
  const merged = (samples || []).map(s => {
    const g = gpsFields(ll[idx.get(s.t)])
    if (g.lat != null) n++
    return { ...s, ...g }
  })
  return { samples: merged, gotGps: n > 0 }
}

// Lädt Sekundenwerte (inkl. GPS) für importierte Strava-Einheiten nach, bei denen etwas fehlt:
//  - noch keine Kurven -> alles holen (eine Anfrage)
//  - Kurven da, aber GPS noch nie versucht -> nur Zeit+GPS holen und einmergen
// Feste Pause zwischen Aufrufen hält uns sicher unter Stravas Kurzzeit-Limit (~200/15 Min.).
// Robust gegen Unterbrechung: hasStreams/hasGps markieren erledigte Einheiten, ein Neustart macht weiter.
async function backfillStreams({ delayMs = 5000, limit, onProgress } = {}) {
  let pending = store.listSessions().filter(s => s.source === 'strava' && (!s.hasStreams || !s.hasGps))
  if (limit) pending = pending.slice(0, limit)
  let done = 0, failed = 0
  for (const meta of pending) {
    try {
      const token = await getFreshToken()
      if (!meta.hasStreams) {
        const streams = await fetchStreams(token, meta.stravaActivityId)
        const samples = streams ? streamsToSamples(streams) : []
        const gotGps = samples.some(s => s.lat != null)
        store.updateSession(meta.id, { samples, hasStreams: true, hasGps: true, ...(gotGps ? { cloudSyncedAt: null } : {}) })
      } else {
        const streams = await fetchStreams(token, meta.stravaActivityId, GPS_ONLY_KEYS)
        const full = store.getSession(meta.id)
        const { samples, gotGps } = mergeGps(full?.samples, streams)
        // cloudSyncedAt zurücksetzen, damit der nächste Cloud-Sync die Einheit mit GPS erneut hochlädt
        store.updateSession(meta.id, { samples, hasGps: true, ...(gotGps ? { cloudSyncedAt: null } : {}) })
      }
      done++
    } catch (e) {
      failed++
      console.error(`Streams-Import fehlgeschlagen für ${meta.id}:`, e.message)
    }
    onProgress?.({ done, failed, total: pending.length, last: meta.name })
    await new Promise(res => setTimeout(res, delayMs))
  }
  return { ok: true, done, failed, total: pending.length }
}

function disconnect() {
  const s = store.getSettings()
  s.strava = { ...s.strava, accessToken: '', refreshToken: '', expiresAt: 0, athleteName: '' }
  store.saveSettings(s)
}

module.exports = { connect, uploadTcx, importActivities, backfillStreams, disconnect }
