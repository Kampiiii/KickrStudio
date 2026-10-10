// Trainingspläne: mehrwöchige Abfolgen aus Workouts, die sich in den Kalender eintragen lassen.
// Eigene Pläne nach gängigen Trainingsprinzipien (Grundlage → Sweet Spot → Schwelle → VO2max,
// Belastungswochen im Wechsel mit Erholungswochen). Alle Workouts skalieren über %FTP automatisch.
import { expandSegments, workoutDuration, type Workout } from './model'

export interface PlanSession { workoutId: string }
export interface PlanWeek { title: string; sessions: PlanSession[]; note?: string }

export interface TrainingPlan {
  id: string
  name: string
  goal: string
  level: 'Einsteiger' | 'Fortgeschritten' | 'Wiedereinstieg'
  description: string
  weeks: PlanWeek[]
}

const S = (...ids: string[]): PlanSession[] => ids.map(id => ({ workoutId: 'builtin-' + id }))

export const PLANS: TrainingPlan[] = [
  {
    id: 'plan-basis-8',
    name: 'Basis aufbauen',
    goal: 'Aerobe Grundlage und erste Reize für die FTP',
    level: 'Einsteiger',
    description: 'Acht Wochen mit drei Einheiten pro Woche: viel lockere Grundlage, ab Woche 2 ein Sweet-Spot-Reiz. ' +
      'Jede vierte Woche ist eine Erholungswoche, am Ende steht ein FTP-Test.',
    weeks: [
      { title: 'Woche 1 · Einstieg', sessions: S('grundlage-50', 'erholung-45', 'grundlage-75') },
      { title: 'Woche 2 · Aufbau', sessions: S('grundlage-50', 'sweetspot-3x10', 'grundlage-75') },
      { title: 'Woche 3 · Aufbau', sessions: S('grundlage-50', 'sweetspot-3x10', 'grundlage-90') },
      { title: 'Woche 4 · Erholung', sessions: S('erholung-45', 'grundlage-30', 'grundlage-50'), note: 'Bewusst leicht — hier passiert die Anpassung.' },
      { title: 'Woche 5 · Aufbau', sessions: S('grundlage-50', 'sweetspot-4x10', 'grundlage-90') },
      { title: 'Woche 6 · Aufbau', sessions: S('tempo-60', 'sweetspot-4x10', 'grundlage-120') },
      { title: 'Woche 7 · Höhepunkt', sessions: S('sweetspot-3x15', 'grundlage-50', 'grundlage-120') },
      { title: 'Woche 8 · Test', sessions: S('erholung-45', 'grundlage-50', 'ftp-test-20'), note: 'Neue FTP am Ende übernehmen.' },
    ],
  },
  {
    id: 'plan-ftp-6',
    name: 'FTP-Booster',
    goal: 'FTP steigern mit Sweet Spot und Schwelle',
    level: 'Fortgeschritten',
    description: 'Sechs Wochen, vier Einheiten pro Woche. Sweet Spot und Schwelle tragen die Belastung, eine lange ' +
      'Grundlagenfahrt hält die Basis. Woche 4 ist leichter, am Ende steht der Rampentest.',
    weeks: [
      { title: 'Woche 1', sessions: S('sweetspot-3x15', 'grundlage-50', 'schwelle-3x10', 'grundlage-90') },
      { title: 'Woche 2', sessions: S('sweetspot-4x10', 'grundlage-50', 'schwelle-2x15', 'grundlage-90') },
      { title: 'Woche 3', sessions: S('schwelle-5x5', 'grundlage-50', 'overunder-3x12', 'grundlage-120') },
      { title: 'Woche 4 · Erholung', sessions: S('erholung-45', 'sweetspot-3x10', 'grundlage-50', 'grundlage-75'), note: 'Weniger Intensität, FTP-Reize sacken lassen.' },
      { title: 'Woche 5', sessions: S('schwelle-2x15', 'grundlage-50', 'overunder-3x12', 'grundlage-120') },
      { title: 'Woche 6 · Test', sessions: S('erholung-45', 'schwelle-3x10', 'grundlage-50', 'ramptest'), note: 'Rampentest zum Schluss, ausgeruht antreten.' },
    ],
  },
  {
    id: 'plan-vo2-4',
    name: 'VO2max-Block',
    goal: 'Maximale Sauerstoffaufnahme verbessern',
    level: 'Fortgeschritten',
    description: 'Vier Wochen, drei Einheiten pro Woche: zwei harte VO2max-Einheiten und eine lockere Fahrt. ' +
      'Als kurzer, intensiver Block gedacht — danach wieder Grundlage.',
    weeks: [
      { title: 'Woche 1', sessions: S('vo2max-4x4', 'grundlage-50', 'pyramide') },
      { title: 'Woche 2', sessions: S('vo2max-5x3', 'grundlage-75', '3030-2x10') },
      { title: 'Woche 3', sessions: S('vo2max-6x3', 'grundlage-50', 'vo2max-4x4') },
      { title: 'Woche 4 · Erholung', sessions: S('erholung-45', 'schwelle-3x10', 'grundlage-75'), note: 'Der Reiz wirkt in der Erholungswoche nach.' },
    ],
  },
  {
    id: 'plan-wiedereinstieg-6',
    name: 'Wiedereinstieg nach Pause',
    goal: 'Nach Krankheit, Verletzung oder Pause behutsam zurückkommen',
    level: 'Wiedereinstieg',
    description: 'Sechs Wochen, drei kurze bis mittlere Einheiten pro Woche. Anfangs nur Grundlage und Erholung, ' +
      'erst ab Woche 4 ein erster Sweet-Spot-Reiz. Bei Beschwerden kürzen oder auslassen und ärztlichen Rat einholen.',
    weeks: [
      { title: 'Woche 1 · Ankommen', sessions: S('erholung-45', 'grundlage-30', 'erholung-45') },
      { title: 'Woche 2', sessions: S('grundlage-30', 'erholung-45', 'grundlage-50') },
      { title: 'Woche 3', sessions: S('grundlage-50', 'erholung-45', 'grundlage-50') },
      { title: 'Woche 4', sessions: S('grundlage-50', 'sweetspot-3x10', 'grundlage-75') },
      { title: 'Woche 5', sessions: S('grundlage-50', 'sweetspot-3x10', 'grundlage-90') },
      { title: 'Woche 6', sessions: S('tempo-60', 'grundlage-50', 'grundlage-90') },
    ],
  },
  {
    id: 'plan-kompakt-4',
    name: 'Kompakt — 2 Einheiten pro Woche',
    goal: 'Form halten und leicht verbessern mit wenig Zeit',
    level: 'Einsteiger',
    description: 'Vier Wochen, nur zwei Einheiten pro Woche: eine intensive und eine ruhige. Passt zu vollen Wochen.',
    weeks: [
      { title: 'Woche 1', sessions: S('sweetspot-3x10', 'grundlage-75') },
      { title: 'Woche 2', sessions: S('sweetspot-3x15', 'grundlage-75') },
      { title: 'Woche 3', sessions: S('schwelle-3x10', 'grundlage-90') },
      { title: 'Woche 4 · Erholung', sessions: S('tempo-60', 'erholung-45') },
    ],
  },
]

// ---------- Kennzahlen ----------

// Grobe TSS-Schätzung aus dem %FTP-Verlauf: Dauer in h × (Anteil an der FTP)² × 100
export function workoutTss(w: Workout): number {
  let tss = 0
  for (const s of expandSegments(w.segments)) {
    const mid = s.freeride ? 90 : (s.startPct + s.endPct) / 2
    tss += ((s.endSec - s.startSec) / 3600) * Math.pow(mid / 100, 2) * 100
  }
  return Math.round(tss)
}

export interface WeekStats { sec: number; tss: number; count: number }

export function weekStats(week: PlanWeek, byId: Map<string, Workout>): WeekStats {
  let sec = 0, tss = 0
  for (const s of week.sessions) {
    const w = byId.get(s.workoutId)
    if (!w) continue
    sec += workoutDuration(w)
    tss += workoutTss(w)
  }
  return { sec, tss, count: week.sessions.length }
}

export const maxSessionsPerWeek = (p: TrainingPlan) => Math.max(...p.weeks.map(w => w.sessions.length))

// ---------- Datum ----------

export const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return iso(new Date(y, m - 1, d + n))
}

// Montag der kommenden Woche (liegt heute ein Montag, dann heute)
export function nextMonday(from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const dow = (d.getDay() + 6) % 7 // Mo=0
  d.setDate(d.getDate() + (dow === 0 ? 0 : 7 - dow))
  return iso(d)
}

// Montag der Woche, in der ein beliebiges Datum liegt (damit Wochen auch bei einem Startdatum mitten
// in der Woche sauber von Montag an gerechnet werden)
export function mondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return addDays(isoDate, -((dt.getDay() + 6) % 7))
}

export const defaultWeekdays = (n: number): number[] =>
  n <= 1 ? [1] : n === 2 ? [1, 5] : n === 3 ? [1, 3, 5] : n === 4 ? [1, 3, 5, 6] : [0, 1, 3, 5, 6].slice(0, n)

export interface PlannedSession { date: string; workoutId: string; weekNo: number; note: string }

// Verteilt die Einheiten jeder Woche auf die gewählten Wochentage (in Reihenfolge). Die Wochen werden
// ab dem Montag der Startwoche gezählt. Hat eine Woche weniger Einheiten als Wochentage gewählt sind,
// werden die ersten Tage genutzt.
export function schedulePlan(plan: TrainingPlan, startDate: string, weekdays: number[]): PlannedSession[] {
  const monday = mondayOf(startDate)
  const days = [...weekdays].sort((a, b) => a - b)
  const out: PlannedSession[] = []
  plan.weeks.forEach((week, wi) => {
    week.sessions.forEach((s, si) => {
      out.push({
        date: addDays(monday, wi * 7 + days[si]), workoutId: s.workoutId, weekNo: wi + 1,
        note: `${plan.name} · ${week.title}${week.note ? ' — ' + week.note : ''}`,
      })
    })
  })
  return out
}
