// Strava-Integration: OAuth über Systembrowser + localhost-Callback,
// Token-Refresh, TCX-Upload mit Status-Polling.
const http = require('http')
const { shell } = require('electron')
const store = require('./store.cjs')

const AUTH_URL = 'https://www.strava.com/oauth/authorize'
const TOKEN_URL = 'https://www.strava.com/oauth/token'
const UPLOAD_URL = 'https://www.strava.com/api/v3/uploads'

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
      shell.openExternal(`${AUTH_URL}?client_id=${clientId}&response_type=code&redirect_uri=${redirect}&scope=activity:write,read&approval_prompt=auto`)
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

function disconnect() {
  const s = store.getSettings()
  s.strava = { ...s.strava, accessToken: '', refreshToken: '', expiresAt: 0, athleteName: '' }
  store.saveSettings(s)
}

module.exports = { connect, uploadTcx, disconnect }
