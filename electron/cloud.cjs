// Google-Cloud-Anbindung:
//   1) Sync: Einheiten/Körperdaten/Plan -> GCS (raw_json/) -> BigQuery-MERGE in die Iceberg-Tabellen
//   2) Coach: Fragen an den Trainingsagenten (ADK auf Cloud Run) stellen
//
// Anmeldung über die Application Default Credentials (gcloud auth application-default login),
// es liegen keine Schlüssel in der App. Die Google-Bibliotheken werden erst bei Bedarf geladen.
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const store = require('./store.cjs')

function config() {
  const c = store.getSettings().cloud || {}
  for (const k of ['projectId', 'bucket', 'dataset', 'location']) {
    if (!c[k]) throw new Error(`Google Cloud ist nicht eingerichtet (Einstellungen → Google Cloud: "${k}" fehlt).`)
  }
  return c
}

// ---------- SQL ----------

const q = (c, name) => '`' + `${c.projectId}.${c.dataset}.${name}` + '`'
const uri = (c, folder) => `gs://${c.bucket}/raw_json/${folder}/*.json`

// Externe Tabellen über die hochgeladenen JSON-Zeilen + idempotente MERGEs in die Iceberg-Tabellen.
function buildSql(c, { sessions, body, planRows }) {
  const parts = []

  if (sessions) {
    parts.push(`
CREATE OR REPLACE EXTERNAL TABLE ${q(c, 'raw_json_sessions')} (
  id STRING, name STRING, workoutId STRING, startedAt STRING, durationSec INT64, ftpAtTime INT64,
  summary STRUCT<avgPower FLOAT64, maxPower FLOAT64, np FLOAT64, \`if\` FLOAT64, tss FLOAT64, kj FLOAT64,
                 avgHr FLOAT64, maxHr FLOAT64, avgCadence FLOAT64, best60s FLOAT64>,
  stravaActivityId INT64,
  samples ARRAY<STRUCT<t INT64, power FLOAT64, hr FLOAT64, cadence FLOAT64, target FLOAT64>>
) OPTIONS (format = 'NEWLINE_DELIMITED_JSON', uris = ['${uri(c, 'sessions')}'], ignore_unknown_values = true);

MERGE ${q(c, 'sessions')} t
USING (
  SELECT id AS session_id, name, workoutId AS workout_id, TIMESTAMP(startedAt) AS started_at,
         durationSec AS duration_sec, ftpAtTime AS ftp_at_time,
         summary.avgPower AS avg_power, summary.maxPower AS max_power, summary.np AS normalized_power,
         summary.\`if\` AS intensity_factor, summary.tss AS tss, summary.kj AS kilojoules,
         summary.avgHr AS avg_hr, summary.maxHr AS max_hr, summary.avgCadence AS avg_cadence,
         summary.best60s AS best_60s_power, stravaActivityId AS strava_activity_id
  FROM ${q(c, 'raw_json_sessions')}
) s
ON t.session_id = s.session_id
WHEN MATCHED THEN UPDATE SET t.strava_activity_id = s.strava_activity_id
WHEN NOT MATCHED THEN INSERT ROW;

MERGE ${q(c, 'samples')} t
USING (
  SELECT r.id AS session_id, smp.t AS t_sec,
         TIMESTAMP_ADD(TIMESTAMP(r.startedAt), INTERVAL smp.t SECOND) AS ts,
         smp.power AS power, smp.hr AS hr, smp.cadence AS cadence, smp.target AS target_power
  FROM ${q(c, 'raw_json_sessions')} r, UNNEST(r.samples) smp
) s
ON t.session_id = s.session_id AND t.t_sec = s.t_sec AND DATE(t.ts) = DATE(s.ts)
WHEN NOT MATCHED THEN INSERT ROW;`)
  }

  if (body) {
    parts.push(`
CREATE OR REPLACE EXTERNAL TABLE ${q(c, 'raw_json_body')} (
  date STRING, weightKg FLOAT64, fatPct FLOAT64, fatKg FLOAT64, fatFreeKg FLOAT64,
  muscleKg FLOAT64, waterKg FLOAT64, boneKg FLOAT64
) OPTIONS (format = 'NEWLINE_DELIMITED_JSON', uris = ['${uri(c, 'body')}'], ignore_unknown_values = true);

MERGE ${q(c, 'body')} t
USING (
  SELECT TIMESTAMP(date) AS measured_at, weightKg AS weight_kg, fatPct AS fat_pct, fatKg AS fat_kg,
         fatFreeKg AS fat_free_kg, muscleKg AS muscle_kg, waterKg AS water_kg, boneKg AS bone_kg
  FROM ${q(c, 'raw_json_body')}
) s
ON t.measured_at = s.measured_at
WHEN NOT MATCHED THEN INSERT ROW;`)
  }

  if (planRows > 0) {
    parts.push(`
CREATE OR REPLACE EXTERNAL TABLE ${q(c, 'raw_json_plan')} (
  id STRING, date STRING, workoutId STRING, workoutName STRING, note STRING, kind STRING
) OPTIONS (format = 'NEWLINE_DELIMITED_JSON', uris = ['${uri(c, 'plan')}'], ignore_unknown_values = true);

MERGE ${q(c, 'plan')} t
USING (
  SELECT id AS entry_id, PARSE_DATE('%Y-%m-%d', date) AS plan_date, IFNULL(kind, 'workout') AS kind,
         workoutId AS workout_id, workoutName AS workout_name, note
  FROM ${q(c, 'raw_json_plan')}
) s
ON t.entry_id = s.entry_id
WHEN MATCHED THEN UPDATE SET t.plan_date = s.plan_date, t.kind = s.kind, t.workout_id = s.workout_id,
                             t.workout_name = s.workout_name, t.note = s.note
WHEN NOT MATCHED THEN INSERT ROW
WHEN NOT MATCHED BY SOURCE THEN DELETE;`)
  } else {
    parts.push(`\nDELETE FROM ${q(c, 'plan')} WHERE TRUE;`)
  }

  return parts.join('\n')
}

const ndjson = (rows) => rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')

// ---------- Sync ----------

function readSessionFiles() {
  store.ensureDirs()
  return fs.readdirSync(store.HISTORY_DIR).filter(f => f.endsWith('.json')).map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(store.HISTORY_DIR, f), 'utf8')) } catch { return null }
  }).filter(s => s && s.id)
}

async function sync() {
  const started = Date.now()
  const c = config()
  const { Storage } = require('@google-cloud/storage')
  const { BigQuery } = require('@google-cloud/bigquery')
  const bucket = new Storage({ projectId: c.projectId }).bucket(c.bucket)

  const sessions = readSessionFiles()
  const pending = sessions.filter(s => !s.cloudSyncedAt || (s.stravaActivityId || null) !== (s.cloudStravaId || null))
  for (const s of pending) {
    // eine Zeile je Einheit; cloud*-Felder sind lokale Statusfelder und werden nicht mit hochgeladen
    const { cloudSyncedAt, cloudStravaId, ...clean } = s
    await bucket.file(`raw_json/sessions/${s.id}.json`).save(JSON.stringify(clean) + '\n', { contentType: 'application/json' })
  }

  const bodyRows = store.listBody()
  const planRows = store.listPlan()
  await bucket.file('raw_json/body/body.json').save(ndjson(bodyRows), { contentType: 'application/json' })
  await bucket.file('raw_json/plan/plan.json').save(ndjson(planRows), { contentType: 'application/json' })

  const sql = buildSql(c, { sessions: sessions.length > 0, body: bodyRows.length > 0, planRows: planRows.length })
  const bq = new BigQuery({ projectId: c.projectId, location: c.location })
  const [job] = await bq.createQueryJob({ query: sql, location: c.location })
  await job.getQueryResults()

  const now = new Date().toISOString()
  for (const s of pending) store.updateSession(s.id, { cloudSyncedAt: now, cloudStravaId: s.stravaActivityId || null })

  return {
    ok: true,
    uploadedSessions: pending.length,
    totalSessions: sessions.length,
    bodyRows: bodyRows.length,
    planRows: planRows.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }
}

async function test() {
  const c = config()
  const { Storage } = require('@google-cloud/storage')
  const { BigQuery } = require('@google-cloud/bigquery')
  const [bucketOk] = await new Storage({ projectId: c.projectId }).bucket(c.bucket).exists()
  const [datasetOk] = await new BigQuery({ projectId: c.projectId, location: c.location }).dataset(c.dataset).exists()
  const problems = []
  if (!bucketOk) problems.push(`Bucket "${c.bucket}" nicht gefunden`)
  if (!datasetOk) problems.push(`Dataset "${c.dataset}" nicht gefunden`)
  return problems.length ? { ok: false, error: problems.join('; ') } : { ok: true }
}

// ---------- Coach (Agent auf Cloud Run) ----------

function gcloudCommand() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
    'C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
  ]
  const found = candidates.find(p => { try { return fs.existsSync(p) } catch { return false } })
  return found ? `"${found}"` : 'gcloud'
}

// Der Agent läuft privat auf Cloud Run: Aufrufe brauchen ein Google-ID-Token deiner Anmeldung.
function identityToken() {
  return new Promise((resolve, reject) => {
    exec(`${gcloudCommand()} auth print-identity-token`, { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error('ID-Token nicht verfügbar (ist gcloud installiert und angemeldet?): ' + (stderr || err.message).trim()))
      else resolve(stdout.trim())
    })
  })
}

const createdSessions = new Set()

async function ensureAgentSession(base, app, user, sessionId, headers) {
  if (createdSessions.has(sessionId)) return
  const r = await fetch(`${base}/apps/${app}/users/${user}/sessions/${sessionId}`, {
    method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(90000),
  })
  if (!r.ok && r.status !== 409) throw new Error(`Agent-Sitzung fehlgeschlagen (HTTP ${r.status}): ${(await r.text()).slice(0, 300)}`)
  createdSessions.add(sessionId)
}

function parseEvents(events) {
  const tools = []
  let answer = ''
  for (const ev of Array.isArray(events) ? events : []) {
    for (const part of ev?.content?.parts || []) {
      const call = part.functionCall || part.function_call
      if (call) tools.push({ name: call.name, args: call.args || {} })
    }
    const text = (ev?.content?.parts || []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('')
    const hasCall = (ev?.content?.parts || []).some(p => p.functionCall || p.function_call)
    if (text && !hasCall && ev?.content?.role !== 'user') answer = text
  }
  return { answer, tools }
}

async function askAgent(question, sessionId) {
  const c = store.getSettings().cloud || {}
  if (!c.agentUrl) throw new Error('Der Coach ist noch nicht verbunden (Einstellungen → Google Cloud → Agent-URL).')
  const base = c.agentUrl.replace(/\/+$/, '')
  const app = c.agentApp || 'kickr_agent'
  const user = 'kickr-user'
  const token = await identityToken()
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const body = JSON.stringify({ appName: app, userId: user, sessionId, newMessage: { role: 'user', parts: [{ text: question }] } })

  await ensureAgentSession(base, app, user, sessionId, headers)
  let r = await fetch(`${base}/run`, { method: 'POST', headers, body, signal: AbortSignal.timeout(180000) })
  if (r.status === 404) {
    // Cloud Run hat zwischenzeitlich neu gestartet, die Sitzung ist weg -> neu anlegen
    createdSessions.delete(sessionId)
    await ensureAgentSession(base, app, user, sessionId, headers)
    r = await fetch(`${base}/run`, { method: 'POST', headers, body, signal: AbortSignal.timeout(180000) })
  }
  if (!r.ok) throw new Error(`Agent-Anfrage fehlgeschlagen (HTTP ${r.status}): ${(await r.text()).slice(0, 400)}`)
  const { answer, tools } = parseEvents(await r.json())
  return { ok: true, answer: answer || '(keine Antwort erhalten)', tools }
}

module.exports = { sync, test, askAgent, buildSql, parseEvents, ndjson }
