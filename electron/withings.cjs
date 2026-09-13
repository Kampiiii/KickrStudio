// Withings-Integration: OAuth über Systembrowser + localhost-Callback,
// Token-Refresh und Abruf der Körperdaten (Gewicht, Fett, Muskeln, Wasser, Knochen).
const http = require('http')
const { shell } = require('electron')
const store = require('./store.cjs')

const AUTH_URL = 'https://account.withings.com/oauth2_user/authorize2'
const API_OAUTH = 'https://wbsapi.withings.net/v2/oauth2'
const API_MEASURE = 'https://wbsapi.withings.net/measure'

// Withings-Messtypen → unsere Feldnamen (Wert = value * 10^unit)
const MEAS_TYPES = { 1: 'weightKg', 6: 'fatPct', 5: 'fatFreeKg', 8: 'fatKg', 76: 'muscleKg', 77: 'waterKg', 88: 'boneKg' }

async function apiCall(url, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = await r.json()
  if (data.status !== 0) throw new Error(`Withings-API-Fehler ${data.status}: ${data.error || JSON.stringify(data)}`)
  return data.body
}

function connect() {
  const settings = store.getSettings()
  const { clientId, clientSecret } = settings.withings
  if (!clientId || !clientSecret) return Promise.resolve({ ok: false, error: 'Client-ID und Client-Secret fehlen (Settings → Withings).' })
  const port = settings.httpPort || 4571
  const redirectUri = `http://localhost:${port}/withings/callback`
  const state = Math.random().toString(36).slice(2)

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      if (url.pathname !== '/withings/callback') { res.writeHead(404); res.end(); return }
      const code = url.searchParams.get('code')
      const err = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<html><body style="font-family:sans-serif;background:#0b0f14;color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>${err || !code ? 'Withings-Verbindung abgebrochen' : 'Mit Withings verbunden ✓'}</h2><p>Du kannst dieses Fenster schließen und zu KickrStudio zurückkehren.</p></div></body></html>`)
      clearTimeout(timeout)
      server.close()
      if (err || !code) { resolve({ ok: false, error: 'Autorisierung abgebrochen.' }); return }
      try {
        const body = await apiCall(API_OAUTH, {
          action: 'requesttoken', grant_type: 'authorization_code',
          client_id: clientId, client_secret: clientSecret,
          code, redirect_uri: redirectUri,
        })
        const s = store.getSettings()
        s.withings = {
          ...s.withings,
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in || 10800),
          userId: String(body.userid || ''),
        }
        store.saveSettings(s)
        resolve({ ok: true })
      } catch (e) {
        resolve({ ok: false, error: String(e.message || e) })
      }
    })
    const timeout = setTimeout(() => { try { server.close() } catch { } resolve({ ok: false, error: 'Zeitüberschreitung – keine Antwort von Withings.' }) }, 180000)
    server.on('error', (e) => { clearTimeout(timeout); resolve({ ok: false, error: `Callback-Port ${port} belegt: ${e.message}` }) })
    server.listen(port, '127.0.0.1', () => {
      const u = new URL(AUTH_URL)
      u.searchParams.set('response_type', 'code')
      u.searchParams.set('client_id', clientId)
      u.searchParams.set('scope', 'user.metrics')
      u.searchParams.set('redirect_uri', redirectUri)
      u.searchParams.set('state', state)
      shell.openExternal(u.toString())
    })
  })
}

async function getFreshToken() {
  const settings = store.getSettings()
  const w = settings.withings
  if (!w.refreshToken) throw new Error('Nicht mit Withings verbunden (Settings → Withings → Verbinden).')
  if (w.expiresAt && w.expiresAt > Math.floor(Date.now() / 1000) + 60) return w.accessToken
  const body = await apiCall(API_OAUTH, {
    action: 'requesttoken', grant_type: 'refresh_token',
    client_id: w.clientId, client_secret: w.clientSecret,
    refresh_token: w.refreshToken,
  })
  settings.withings = {
    ...w,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + (body.expires_in || 10800),
  }
  store.saveSettings(settings)
  return body.access_token
}

// Holt Messungen (standardmäßig die letzten 2 Jahre) und mischt sie in body.json.
async function sync() {
  const token = await getFreshToken()
  const startdate = Math.floor(Date.now() / 1000) - 2 * 365 * 86400
  const entries = []
  let offset = 0
  for (let page = 0; page < 20; page++) {
    const r = await fetch(API_MEASURE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${token}` },
      body: new URLSearchParams({
        action: 'getmeas', category: '1',
        meastypes: Object.keys(MEAS_TYPES).join(','),
        startdate: String(startdate),
        ...(offset ? { offset: String(offset) } : {}),
      }).toString(),
    })
    const data = await r.json()
    if (data.status !== 0) throw new Error(`Withings-API-Fehler ${data.status}: ${data.error || ''}`)
    for (const grp of data.body.measuregrps || []) {
      const entry = { date: new Date(grp.date * 1000).toISOString() }
      for (const m of grp.measures || []) {
        const field = MEAS_TYPES[m.type]
        if (field) entry[field] = Math.round(m.value * Math.pow(10, m.unit) * 100) / 100
      }
      if (Object.keys(entry).length > 1) entries.push(entry)
    }
    if (!data.body.more) break
    offset = data.body.offset
  }
  const merged = store.mergeBody(entries)

  // Optional: aktuelles Gewicht ins Leistungsprofil übernehmen
  const settings = store.getSettings()
  settings.withings.lastSyncAt = new Date().toISOString()
  const latestWeight = [...merged].reverse().find(e => e.weightKg)
  if (settings.withings.autoWeight && latestWeight) settings.weightKg = latestWeight.weightKg
  store.saveSettings(settings)

  return { ok: true, count: entries.length, total: merged.length, latestWeight: latestWeight?.weightKg }
}

function disconnect() {
  const s = store.getSettings()
  s.withings = { ...s.withings, accessToken: '', refreshToken: '', expiresAt: 0, userId: '' }
  store.saveSettings(s)
}

module.exports = { connect, sync, disconnect }
