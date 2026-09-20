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
  cloud: { projectId: 'kickr-studio-lab', bucket: 'kickr-studio-lab-data', dataset: 'kickr', location: 'europe-west3', agentUrl: '', agentApp: 'kickr_agent', autoSync: false },
  autoConnect: true,
  httpPort: 4571,
}

function ensureDirs() {
  for (const d of [DATA_DIR, WORKOUTS_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true })
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJsonAtomic(file, data, pretty = true) {
  fs.writeFileSync(file, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data))
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
    cloud: { ...DEFAULT_SETTINGS.cloud, ...(s.cloud || {}) },
  }
}

function saveSettings(settings) {
  ensureDirs()
  writeJsonAtomic(SETTINGS_FILE, settings)
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
  writeJsonAtomic(path.join(WORKOUTS_DIR, workout.id + '.json'), workout)
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
  writeJsonAtomic(path.join(HISTORY_DIR, session.id + '.json'), session, false)
  return session
}

function updateSession(id, patch) {
  const s = getSession(id)
  if (!s) return null
  const merged = { ...s, ...patch }
  writeJsonAtomic(path.join(HISTORY_DIR, id + '.json'), merged, false)
  return merged
}

function deleteSession(id) {
  const f = path.join(HISTORY_DIR, id + '.json')
  if (fs.existsSync(f)) fs.unlinkSync(f)
}

const PLAN_FILE = path.join(DATA_DIR, 'plan.json')

function listPlan() {
  return readJson(PLAN_FILE, [])
}

function savePlanEntry(entry) {
  ensureDirs()
  if (!entry.id) entry.id = 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const all = listPlan().filter(e => e.id !== entry.id)
  all.push(entry)
  all.sort((a, b) => a.date.localeCompare(b.date))
  writeJsonAtomic(PLAN_FILE, all)
  return entry
}

function deletePlanEntry(id) {
  ensureDirs()
  const all = listPlan().filter(e => e.id !== id)
  writeJsonAtomic(PLAN_FILE, all)
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
  writeJsonAtomic(BODY_FILE, merged)
  return merged
}

const DRAFT_FILE = path.join(DATA_DIR, 'draft-session.json')

// Zwischenspeicher einer laufenden Einheit (alle ~15 s aktualisiert), damit ein
// abgebrochener Vorgang (Absturz, versehentliches Schließen) nicht komplett
// verloren geht, sondern beim nächsten Start zur Wiederherstellung angeboten wird.
function getDraftSession() {
  return readJson(DRAFT_FILE, null)
}

function saveDraftSession(draft) {
  ensureDirs()
  writeJsonAtomic(DRAFT_FILE, draft, false)
}

function clearDraftSession() {
  try { fs.unlinkSync(DRAFT_FILE) } catch { }
}

function getQueuedWorkout() {
  return readJson(QUEUE_FILE, null)
}

function setQueuedWorkout(entry) {
  ensureDirs()
  if (entry === null) { try { fs.unlinkSync(QUEUE_FILE) } catch { } }
  else writeJsonAtomic(QUEUE_FILE, entry)
}

module.exports = {
  DATA_DIR, WORKOUTS_DIR, HISTORY_DIR, QUEUE_FILE, DEFAULT_SETTINGS,
  ensureDirs, getSettings, saveSettings,
  listWorkouts, saveWorkout, deleteWorkout,
  listSessions, getSession, saveSession, updateSession, deleteSession,
  getQueuedWorkout, setQueuedWorkout,
  listBody, mergeBody, BODY_FILE,
  listPlan, savePlanEntry, deletePlanEntry, PLAN_FILE,
  getDraftSession, saveDraftSession, clearDraftSession, DRAFT_FILE,
}
