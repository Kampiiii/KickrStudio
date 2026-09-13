#!/usr/bin/env node
// MCP-Server für KickrStudio: gibt Claude Desktop Zugriff auf Profil,
// Trainingshistorie und Workout-Bibliothek (stdio-Transport).
// Liest/schreibt dieselben Dateien wie die Desktop-App (%APPDATA%/kickr-studio).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const DATA_DIR = path.join(process.env.APPDATA || os.homedir(), 'kickr-studio')
const WORKOUTS_DIR = path.join(DATA_DIR, 'workouts')
const HISTORY_DIR = path.join(DATA_DIR, 'history')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const QUEUE_FILE = path.join(DATA_DIR, 'queued-workout.json')
const BUILTINS_FILE = path.join(DATA_DIR, 'builtin-workouts.json')
const PLAN_FILE = path.join(DATA_DIR, 'plan.json')

for (const d of [DATA_DIR, WORKOUTS_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true })

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

const getSettings = () => readJson(SETTINGS_FILE, { ftp: 200, ftpHistory: [], weightKg: 78, hrMax: 185, powerZones: [] })

const listSessionMetas = () =>
  fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.json'))
    .map(f => { const s = readJson(path.join(HISTORY_DIR, f), null); if (!s) return null; const { samples, ...meta } = s; return meta })
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))

const listAllWorkouts = () => {
  const builtins = readJson(BUILTINS_FILE, [])
  const customs = fs.readdirSync(WORKOUTS_DIR).filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(WORKOUTS_DIR, f), null)).filter(Boolean)
  return [...builtins, ...customs]
}

const segmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['warmup', 'cooldown', 'ramp']), sec: z.number().int().min(10).max(14400), fromPct: z.number().min(0).max(250), toPct: z.number().min(0).max(250) }),
  z.object({ type: z.literal('steady'), sec: z.number().int().min(10).max(14400), pct: z.number().min(0).max(250) }),
  z.object({ type: z.literal('intervals'), reps: z.number().int().min(1).max(50), onSec: z.number().int().min(10).max(3600), onPct: z.number().min(0).max(250), offSec: z.number().int().min(10).max(3600), offPct: z.number().min(0).max(250) }),
  z.object({ type: z.literal('freeride'), sec: z.number().int().min(60).max(28800) }),
])

const workoutDuration = (segments) => segments.reduce((t, s) =>
  t + (s.type === 'intervals' ? s.reps * (s.onSec + s.offSec) : s.sec), 0)

const json = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - ys) / 86400000 + 1) / 7)).padStart(2, '0')}`
}

const server = new McpServer({ name: 'kickr-studio', version: '0.1.0' })

server.tool(
  'get_profile',
  'Leistungsprofil des Athleten: FTP (inkl. Verlauf), Gewicht, HF-Werte, Leistungszonen.',
  {},
  async () => {
    const s = getSettings()
    return json({
      ftp: s.ftp, ftpHistory: s.ftpHistory, weightKg: s.weightKg,
      heightCm: s.heightCm ?? null, birthYear: s.birthYear ?? null,
      age: s.birthYear ? new Date().getFullYear() - s.birthYear : null,
      wattsPerKg: s.weightKg ? Math.round((s.ftp / s.weightKg) * 100) / 100 : null,
      hrMax: s.hrMax, hrRest: s.hrRest, powerZones: s.powerZones,
    })
  }
)

server.tool(
  'get_body_composition',
  'Körperdaten von der Withings-Waage im Zeitverlauf: Gewicht, Körperfett %, Muskelmasse, Wasser, Knochenmasse (kg). Zum Verfolgen der Körperzusammensetzung neben dem Training. days begrenzt den Zeitraum (Default 180).',
  { days: z.number().int().min(7).max(1095).optional() },
  async ({ days }) => {
    const all = readJson(path.join(DATA_DIR, 'body.json'), [])
    const cutoff = Date.now() - (days || 180) * 86400000
    const entries = all.filter(e => new Date(e.date).getTime() >= cutoff)
    const latest = {}
    for (const e of entries) for (const k of ['weightKg', 'fatPct', 'muscleKg', 'waterKg', 'boneKg']) if (e[k] != null) latest[k] = e[k]
    const s = getSettings()
    return json({
      latest,
      wattsPerKg: latest.weightKg && s.ftp ? Math.round((s.ftp / latest.weightKg) * 100) / 100 : null,
      count: entries.length,
      entries,
    })
  }
)

server.tool(
  'set_ftp',
  'Setzt die FTP des Athleten (Watt). Nur nach Rücksprache mit dem Nutzer verwenden.',
  { ftp: z.number().int().min(50).max(600) },
  async ({ ftp }) => {
    const s = getSettings()
    s.ftp = ftp
    s.ftpHistory = [...(s.ftpHistory || []), { date: new Date().toISOString().slice(0, 10), ftp }]
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2))
    return json({ ok: true, ftp })
  }
)

server.tool(
  'list_sessions',
  'Absolvierte Trainingseinheiten (neueste zuerst) mit Kennzahlen: Dauer, Ø/NP-Leistung, IF, TSS, HF, Zonenzeiten. Optional limit.',
  { limit: z.number().int().min(1).max(200).optional() },
  async ({ limit }) => json(listSessionMetas().slice(0, limit || 30))
)

server.tool(
  'get_session',
  'Eine Einheit im Detail. include_samples=true liefert den Messwerteverlauf (auf ~300 Punkte reduziert: Leistung, HF, Kadenz, Zielwatt je Zeitpunkt).',
  { id: z.string(), include_samples: z.boolean().optional() },
  async ({ id, include_samples }) => {
    const s = readJson(path.join(HISTORY_DIR, id + '.json'), null)
    if (!s) return json({ error: 'Session nicht gefunden', id })
    if (!include_samples) { const { samples, ...meta } = s; return json(meta) }
    const stride = Math.max(1, Math.floor((s.samples || []).length / 300))
    return json({ ...s, samples: (s.samples || []).filter((_, i) => i % stride === 0) })
  }
)

server.tool(
  'get_training_load',
  'Trainingslast-Aggregat pro ISO-Woche (TSS, Stunden, Einheiten, Zonenzeiten) über die letzten Wochen — Basis für Trainingsempfehlungen und Entwicklungsanalyse.',
  { weeks: z.number().int().min(1).max(52).optional() },
  async ({ weeks }) => {
    const metas = listSessionMetas()
    const map = new Map()
    for (const m of metas) {
      const w = isoWeek(new Date(m.startedAt))
      const e = map.get(w) || { week: w, tss: 0, hours: 0, sessions: 0, zoneSeconds: [] }
      e.tss += m.summary?.tss || 0
      e.hours += (m.durationSec || 0) / 3600
      e.sessions++
      const zs = m.summary?.zoneSeconds || []
      zs.forEach((v, i) => { e.zoneSeconds[i] = (e.zoneSeconds[i] || 0) + v })
      map.set(w, e)
    }
    const list = [...map.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, weeks || 12)
      .map(e => ({ ...e, tss: Math.round(e.tss), hours: Math.round(e.hours * 10) / 10 }))
    const s = getSettings()
    return json({ ftp: s.ftp, ftpHistory: (s.ftpHistory || []).slice(-10), weeklyLoad: list })
  }
)

server.tool(
  'list_workouts',
  'Alle verfügbaren Workouts (eingebaute + eigene + von Claude erstellte) mit Segmentstruktur in %FTP.',
  {},
  async () => json(listAllWorkouts().map(w => ({ id: w.id, name: w.name, source: w.source, kind: w.kind, description: w.description, tags: w.tags, durationSec: workoutDuration(w.segments || []), segments: w.segments })))
)

server.tool(
  'create_workout',
  'Erstellt ein neues Workout in der Bibliothek. Alle Intensitäten in %FTP (z.B. 65 = Zone 2, 90 = Sweet Spot, 105 = Schwelle, 115+ = VO2max). Segmenttypen: warmup/cooldown/ramp {sec, fromPct, toPct}, steady {sec, pct}, intervals {reps, onSec, onPct, offSec, offPct}, freeride {sec}.',
  {
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    tags: z.array(z.string().max(30)).max(6).optional(),
    segments: z.array(segmentSchema).min(1).max(40),
  },
  async ({ name, description, tags, segments }) => {
    const id = name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) + '-' + Date.now().toString(36)
    const workout = { id, name, description: description || '', tags: tags || [], source: 'claude', segments }
    fs.writeFileSync(path.join(WORKOUTS_DIR, id + '.json'), JSON.stringify(workout, null, 2))
    return json({ ok: true, id, durationSec: workoutDuration(segments) })
  }
)

server.tool(
  'queue_workout',
  'Schlägt ein Workout für die nächste Trainingseinheit vor — es erscheint prominent auf der Trainingsseite der App. Entweder workout_id (aus list_workouts) oder direkt ein neues Workout (name + segments). note = kurze Begründung für den Athleten.',
  {
    workout_id: z.string().optional(),
    name: z.string().max(80).optional(),
    segments: z.array(segmentSchema).max(40).optional(),
    note: z.string().max(300).optional(),
  },
  async ({ workout_id, name, segments, note }) => {
    let workout = null
    if (workout_id) {
      workout = listAllWorkouts().find(w => w.id === workout_id)
      if (!workout) return json({ error: 'Workout-ID nicht gefunden', workout_id })
    } else if (name && segments && segments.length) {
      const id = name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').slice(0, 60) + '-' + Date.now().toString(36)
      workout = { id, name, description: note || '', tags: ['Claude'], source: 'claude', segments }
      fs.writeFileSync(path.join(WORKOUTS_DIR, id + '.json'), JSON.stringify(workout, null, 2))
    } else {
      return json({ error: 'Entweder workout_id oder name+segments angeben.' })
    }
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({ workout, note: note || '', queuedAt: new Date().toISOString() }, null, 2))
    return json({ ok: true, queued: workout.name })
  }
)

const listPlan = () => readJson(PLAN_FILE, []).sort((a, b) => a.date.localeCompare(b.date))
function writePlan(entries) { fs.writeFileSync(PLAN_FILE, JSON.stringify(entries, null, 2)) }
const dateRe = /^\d{4}-\d{2}-\d{2}$/

server.tool(
  'get_plan',
  'Der Trainingsplan (Kalender) des Athleten: geplante Einheiten, Pausentage und Ereignisse (z.B. OP, Urlaub) mit Datum. from/to filtern (YYYY-MM-DD, beide optional). Zeigt auch, welche geplanten Tage bereits absolviert wurden (Abgleich mit list_sessions per Datum).',
  { from: z.string().regex(dateRe).optional(), to: z.string().regex(dateRe).optional() },
  async ({ from, to }) => {
    let plan = listPlan()
    if (from) plan = plan.filter(e => e.date >= from)
    if (to) plan = plan.filter(e => e.date <= to)
    const doneDates = new Set(listSessionMetas().map(s => (s.startedAt || '').slice(0, 10)))
    return json(plan.map(e => ({ ...e, done: doneDates.has(e.date) })))
  }
)

server.tool(
  'plan_workout',
  'Plant eine Einheit, eine Pause oder ein Ereignis (z.B. Operation, Urlaub) für ein bestimmtes Datum ein — erscheint im Kalender der Plan-Seite. Bei kind="workout" entweder workout_id (aus list_workouts) oder name+segments für ein neues Workout angeben. Homeoffice-Tage sind flexibel: bereits geplante Einheiten können per erneutem Aufruf mit gleicher id auf ein neues Datum verschoben werden (id aus get_plan).',
  {
    id: z.string().optional().describe('Vorhandenen Eintrag aktualisieren/verschieben (id aus get_plan). Leer lassen für einen neuen Eintrag.'),
    date: z.string().regex(dateRe).describe('YYYY-MM-DD'),
    kind: z.enum(['workout', 'rest', 'event']).default('workout'),
    workout_id: z.string().optional(),
    name: z.string().max(80).optional(),
    segments: z.array(segmentSchema).max(40).optional(),
    note: z.string().max(300).optional(),
  },
  async ({ id, date, kind, workout_id, name, segments, note }) => {
    let workoutName = name || (kind === 'rest' ? 'Pause' : kind === 'event' ? 'Ereignis' : '')
    let usedWorkoutId
    if (kind === 'workout') {
      if (workout_id) {
        const w = listAllWorkouts().find(x => x.id === workout_id)
        if (!w) return json({ error: 'Workout-ID nicht gefunden', workout_id })
        workoutName = w.name
        usedWorkoutId = w.id
      } else if (name && segments && segments.length) {
        const newId = name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').slice(0, 60) + '-' + Date.now().toString(36)
        const workout = { id: newId, name, description: note || '', tags: ['Claude'], source: 'claude', segments }
        fs.writeFileSync(path.join(WORKOUTS_DIR, newId + '.json'), JSON.stringify(workout, null, 2))
        workoutName = name
        usedWorkoutId = newId
      } else {
        return json({ error: 'Für kind="workout" entweder workout_id oder name+segments angeben.' })
      }
    }
    const plan = listPlan()
    const entryId = id || 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const entry = { id: entryId, date, workoutId: usedWorkoutId, workoutName, note: note || '', kind }
    const next = [...plan.filter(e => e.id !== entryId), entry].sort((a, b) => a.date.localeCompare(b.date))
    writePlan(next)
    return json({ ok: true, id: entryId, date, workoutName, kind })
  }
)

server.tool(
  'remove_plan_entry',
  'Entfernt einen Eintrag aus dem Trainingsplan (id aus get_plan).',
  { id: z.string() },
  async ({ id }) => {
    const plan = listPlan()
    const next = plan.filter(e => e.id !== id)
    if (next.length === plan.length) return json({ ok: false, error: 'Eintrag nicht gefunden', id })
    writePlan(next)
    return json({ ok: true })
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
