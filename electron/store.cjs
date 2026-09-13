// Dateibasierte Datenhaltung unter %APPDATA%/kickr-studio.
// Wird vom Electron-Main-Prozess genutzt; der MCP-Server (mcp/server.mjs)
// liest/schreibt dieselben Strukturen eigenständig.
const fs = require('fs')
const path = require('path')

const DATA_DIR = path.join(process.env.APPDATA || require('os').homedir(), 'kickr-studio')
const WORKOUTS_DIR = path.join(DATA_DIR, 'workouts')
const HISTORY_DIR = path.join(DATA_DIR, 'history')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const QUEUE_FILE = path.join(DATA_DIR, 'queued-workout.json')

const DEFAULT_SETTINGS = {
  ftp: 200,
  ftpHistory: [],
  weightKg: 78,
  heightCm: null,
  birthYear: null,
  hrMax: 185,
  hrRest: 55,
  powerZones: [
    { name: 'Z1 Regeneration', pctHigh: 55 },
    { name: 'Z2 Grundlage', pctHigh: 75 },
    { name: 'Z3 Tempo', pctHigh: 90 },
    { name: 'Z4 Schwelle', pctHigh: 105 },
    { name: 'Z5 VO2max', pctHigh: 120 },
    { name: 'Z6 Anaerob', pctHigh: 150 },
    { name: 'Z7 Sprint', pctHigh: 999 },
  ],
  strava: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, athleteName: '' },
  withings: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, userId: '', autoWeight: true, lastSyncAt: '' },
  erg: { smoothingSec: 3, trimStepPct: 5, resendIntervalSec: 10 },
  devices: { trainer: null, hr: null },
  autoConnect: true,
  httpPort: 4571,
}

function ensureDirs() {
  for (const d of [DATA_DIR, WORKOUTS_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true })
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function getSettings() {
  ensureDirs()
  const s = readJson(SETTINGS_FILE, {})
  return {
    ...DEFAULT_SETTINGS, ...s,
    strava: { ...DEFAULT_SETTINGS.strava, ...(s.strava || {}) },
    withings: { ...DEFAULT_SETTINGS.withings, ...(s.withings || {}) },
    erg: { ...DEFAULT_SETTINGS.erg, ...(s.erg || {}) },
    devices: { ...DEFAULT_SETTINGS.devices, ...(s.devices || {}) },
  }
}

function saveSettings(settings) {
  ensureDirs()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workout'
}

function listWorkouts() {
  ensureDirs()
  return fs.readdirSync(WORKOUTS_DIR).filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(WORKOUTS_DIR, f), null)).filter(Boolean)
}

function saveWorkout(workout) {
  ensureDirs()
  if (!workout.id) workout.id = slug(workout.name) + '-' + Date.now().toString(36)
  fs.writeFileSync(path.join(WORKOUTS_DIR, workout.id + '.json'), JSON.stringify(workout, null, 2))
  return workout
}

function deleteWorkout(id) {
  const f = path.join(WORKOUTS_DIR, id + '.json')
  if (fs.existsSync(f)) fs.unlinkSync(f)
}

function listSessions() {
  ensureDirs()
  return fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'))
    .map(f => {
      const s = readJson(path.join(HISTORY_DIR, f), null)
      if (!s) return null
      const { samples, ...meta } = s
      return meta
    })
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
}

function getSession(id) {
  return readJson(path.join(HISTORY_DIR, id + '.json'), null)
}

function saveSession(session) {
  ensureDirs()
  if (!session.id) session.id = (session.startedAt || new Date().toISOString()).replace(/[:.]/g, '-') + '__' + slug(session.name)
  fs.writeFileSync(path.join(HISTORY_DIR, session.id + '.json'), JSON.stringify(session))
  return session
}

function updateSession(id, patch) {
  const s = getSession(id)
  if (!s) return null
  const merged = { ...s, ...patch }
  fs.writeFileSync(path.join(HISTORY_DIR, id + '.json'), JSON.stringify(merged))
  return merged
}

function deleteSession(id) {
  const f = path.join(HISTORY_DIR, id + '.json')
  if (fs.existsSync(f)) fs.unlinkSync(f)
}

const BODY_FILE = path.join(DATA_DIR, 'body.json')

function listBody() {
  return readJson(BODY_FILE, [])
}

// Neue Messungen einmischen (dedupliziert über den Zeitstempel)
function mergeBody(entries) {
  ensureDirs()
  const existing = listBody()
  const byDate = new Map(existing.map(e => [e.date, e]))
  for (const e of entries) byDate.set(e.date, { ...byDate.get(e.date), ...e })
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  fs.writeFileSync(BODY_FILE, JSON.stringify(merged, null, 2))
  return merged
}

function getQueuedWorkout() {
  return readJson(QUEUE_FILE, null)
}

function setQueuedWorkout(entry) {
  ensureDirs()
  if (entry === null) { try { fs.unlinkSync(QUEUE_FILE) } catch { } }
  else fs.writeFileSync(QUEUE_FILE, JSON.stringify(entry, null, 2))
}

module.exports = {
  DATA_DIR, WORKOUTS_DIR, HISTORY_DIR, QUEUE_FILE, DEFAULT_SETTINGS,
  ensureDirs, getSettings, saveSettings,
  listWorkouts, saveWorkout, deleteWorkout,
  listSessions, getSession, saveSession, updateSession, deleteSession,
  getQueuedWorkout, setQueuedWorkout,
  listBody, mergeBody, BODY_FILE,
}
