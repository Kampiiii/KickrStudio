import type { Segment, Workout } from './model'

// Eingebaute Programme — alle Ziele in %FTP, skalieren automatisch mit der FTP.
const BASE_WORKOUTS: Workout[] = [
  {
    id: 'builtin-grundlage-30', name: 'Grundlage 30 min', source: 'builtin', tags: ['Grundlage', 'Z2'],
    description: 'Kurze lockere Einheit in Zone 2. Ideal für Regenerationstage.',
    segments: [
      { type: 'warmup', sec: 300, fromPct: 40, toPct: 65 },
      { type: 'steady', sec: 1200, pct: 65 },
      { type: 'cooldown', sec: 300, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-grundlage-50', name: 'Grundlage 50 min', source: 'builtin', tags: ['Grundlage', 'Z2'],
    description: 'Klassische Grundlagenausdauer in Zone 2 mit kurzen Kadenzwechseln.',
    segments: [
      { type: 'warmup', sec: 420, fromPct: 40, toPct: 65 },
      { type: 'steady', sec: 900, pct: 67 },
      { type: 'intervals', reps: 3, onSec: 60, onPct: 75, offSec: 240, offPct: 65 },
      { type: 'steady', sec: 780, pct: 67 },
      { type: 'cooldown', sec: 300, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-grundlage-75', name: 'Grundlage 75 min', source: 'builtin', tags: ['Grundlage', 'Z2'],
    description: 'Längere Z2-Einheit für die aerobe Basis.',
    segments: [
      { type: 'warmup', sec: 600, fromPct: 40, toPct: 65 },
      { type: 'steady', sec: 1500, pct: 68 },
      { type: 'steady', sec: 300, pct: 72 },
      { type: 'steady', sec: 1500, pct: 68 },
      { type: 'cooldown', sec: 600, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-grundlage-90', name: 'Grundlage 90 min', source: 'builtin', tags: ['Grundlage', 'Z2'],
    description: 'Lange Grundlagenfahrt mit leichten Tempowechseln gegen die Monotonie.',
    segments: [
      { type: 'warmup', sec: 600, fromPct: 40, toPct: 65 },
      { type: 'steady', sec: 1200, pct: 68 },
      { type: 'intervals', reps: 4, onSec: 120, onPct: 76, offSec: 360, offPct: 66 },
      { type: 'steady', sec: 1080, pct: 68 },
      { type: 'cooldown', sec: 600, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-sweetspot-3x10', name: 'Sweet Spot 3×10', source: 'builtin', tags: ['Sweet Spot'],
    description: '3×10 min bei 88–92 % FTP. Effizientes Schwellentraining mit moderater Ermüdung.',
    segments: [
      { type: 'warmup', sec: 600, fromPct: 40, toPct: 70 },
      { type: 'intervals', reps: 3, onSec: 600, onPct: 90, offSec: 300, offPct: 55 },
      { type: 'cooldown', sec: 420, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-sweetspot-2x20', name: 'Sweet Spot 2×20', source: 'builtin', tags: ['Sweet Spot'],
    description: 'Der Klassiker: 2×20 min bei 90 % FTP.',
    segments: [
      { type: 'warmup', sec: 600, fromPct: 40, toPct: 70 },
      { type: 'intervals', reps: 2, onSec: 1200, onPct: 90, offSec: 420, offPct: 55 },
      { type: 'cooldown', sec: 420, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-schwelle-4x8', name: 'Schwelle 4×8', source: 'builtin', tags: ['Schwelle', 'Z4'],
    description: '4×8 min bei 100–105 % FTP nach dem Seiler-Protokoll. Hart, aber sehr wirksam.',
    segments: [
      { type: 'warmup', sec: 720, fromPct: 40, toPct: 75 },
      { type: 'intervals', reps: 4, onSec: 480, onPct: 102, offSec: 300, offPct: 50 },
      { type: 'cooldown', sec: 480, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-vo2max-5x3', name: 'VO2max 5×3', source: 'builtin', tags: ['VO2max', 'Z5'],
    description: '5×3 min bei 115 % FTP mit gleich langen Pausen.',
    segments: [
      { type: 'warmup', sec: 720, fromPct: 40, toPct: 75 },
      { type: 'intervals', reps: 5, onSec: 180, onPct: 115, offSec: 180, offPct: 45 },
      { type: 'cooldown', sec: 480, fromPct: 60, toPct: 40 },
    ],
  },
  {
    id: 'builtin-ramptest', name: 'FTP-Rampentest', source: 'builtin', kind: 'ramptest', tags: ['Test'],
    description: 'Nach 6 min Aufwärmen steigt die Leistung jede Minute um 6 % FTP. Fahre bis zur Ausbelastung, dann „Beenden“ drücken — die neue FTP wird als 75 % der besten Minutenleistung geschätzt.',
    segments: [
      { type: 'warmup', sec: 360, fromPct: 40, toPct: 50 },
      // 40 Minuten-Stufen ab 55 % FTP, +6 %/min — praktisch offenes Ende
      ...Array.from({ length: 40 }, (_, i) => ({ type: 'steady' as const, sec: 60, pct: 55 + i * 6 })),
    ],
  },
  {
    id: 'builtin-freeride', name: 'Freies Fahren', source: 'builtin', kind: 'freeride', tags: ['Frei'],
    description: 'ERG-Modus mit manuell einstellbarem Zielwert — ohne festes Programm.',
    segments: [{ type: 'freeride', sec: 14400 }],
  },
]

// Hilfsfunktionen für wiederkehrende Muster
const WARM = (min: number): Segment => ({ type: 'warmup', sec: min * 60, fromPct: 40, toPct: 72 })
const COOL = (min: number): Segment => ({ type: 'cooldown', sec: min * 60, fromPct: 62, toPct: 40 })
const REST = (min: number, pct = 55): Segment => ({ type: 'steady', sec: min * 60, pct })

// Über/Unter: abwechselnd knapp unter und über der Schwelle, in Blöcken mit Pause
function overUnderBlock(minutes: number, underPct: number, overPct: number): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i < minutes / 3; i++) {
    out.push({ type: 'steady', sec: 120, pct: underPct }, { type: 'steady', sec: 60, pct: overPct })
  }
  return out
}

// Pyramide: 1-2-3-4-3-2-1 min hart, jeweils gleich lange Erholung
function pyramid(onPct: number, offPct: number): Segment[] {
  return [1, 2, 3, 4, 3, 2, 1].flatMap<Segment>(m => [
    { type: 'steady', sec: m * 60, pct: onPct },
    { type: 'steady', sec: m * 60, pct: offPct },
  ])
}

// Eigene Programme nach gängigen Trainingsprinzipien (Zonenmodell, Sweet Spot, Schwelle, VO2max).
const EXTRA_WORKOUTS: Workout[] = [
  {
    id: 'builtin-erholung-45', name: 'Erholung 45 min', source: 'builtin', tags: ['Erholung', 'Z1'],
    description: 'Sehr locker kurbeln, nur zum Durchbluten. Soll sich fast zu leicht anfühlen.',
    segments: [{ type: 'warmup', sec: 300, fromPct: 40, toPct: 52 }, { type: 'steady', sec: 2100, pct: 52 }, COOL(5)],
  },
  {
    id: 'builtin-grundlage-120', name: 'Grundlage 120 min', source: 'builtin', tags: ['Grundlage', 'Z2'],
    description: 'Lange Z2-Einheit für die aerobe Basis, in der Mitte ein kurzer Tempo-Block.',
    segments: [WARM(10), { type: 'steady', sec: 2700, pct: 67 }, { type: 'steady', sec: 600, pct: 74 }, { type: 'steady', sec: 2700, pct: 67 }, COOL(10)],
  },
  {
    id: 'builtin-tempo-60', name: 'Tempo 60 min', source: 'builtin', tags: ['Tempo', 'Z3'],
    description: 'Gleichmäßig im Tempobereich (Z3). Fördert Ausdauer unter Belastung, ohne tief zu ermüden.',
    segments: [WARM(10), { type: 'steady', sec: 2400, pct: 82 }, COOL(10)],
  },
  {
    id: 'builtin-tempo-2x20', name: 'Tempo 2×20', source: 'builtin', tags: ['Tempo', 'Z3'],
    description: 'Zwei lange Tempo-Blöcke bei 85 % FTP. Gleichmäßig bleiben, nicht anfangs zu schnell.',
    segments: [WARM(10), { type: 'intervals', reps: 2, onSec: 1200, onPct: 85, offSec: 300, offPct: 55 }, COOL(10)],
  },
  {
    id: 'builtin-sweetspot-4x10', name: 'Sweet Spot 4×10', source: 'builtin', tags: ['Sweet Spot'],
    description: 'Vier Blöcke à 10 min bei 90 % FTP — viel Reiz für die FTP bei überschaubarer Ermüdung.',
    segments: [WARM(10), { type: 'intervals', reps: 4, onSec: 600, onPct: 90, offSec: 300, offPct: 55 }, COOL(8)],
  },
  {
    id: 'builtin-sweetspot-3x15', name: 'Sweet Spot 3×15', source: 'builtin', tags: ['Sweet Spot'],
    description: 'Drei Blöcke à 15 min bei 91 % FTP. Der Standard-Baustein vieler FTP-Aufbauphasen.',
    segments: [WARM(10), { type: 'intervals', reps: 3, onSec: 900, onPct: 91, offSec: 300, offPct: 55 }, COOL(8)],
  },
  {
    id: 'builtin-schwelle-3x10', name: 'Schwelle 3×10', source: 'builtin', tags: ['Schwelle', 'Z4'],
    description: 'Drei Blöcke à 10 min knapp über FTP (102 %). Konzentriert und kontrolliert fahren.',
    segments: [WARM(12), { type: 'intervals', reps: 3, onSec: 600, onPct: 102, offSec: 300, offPct: 55 }, COOL(8)],
  },
  {
    id: 'builtin-schwelle-2x15', name: 'Schwelle 2×15', source: 'builtin', tags: ['Schwelle', 'Z4'],
    description: 'Zwei lange Schwellenblöcke bei 100 % FTP — trainiert, die FTP über längere Zeit zu halten.',
    segments: [WARM(12), { type: 'intervals', reps: 2, onSec: 900, onPct: 100, offSec: 420, offPct: 55 }, COOL(8)],
  },
  {
    id: 'builtin-schwelle-5x5', name: 'Schwelle 5×5', source: 'builtin', tags: ['Schwelle', 'Z4'],
    description: 'Fünf kürzere Blöcke bei 103 % FTP mit kurzer Erholung.',
    segments: [WARM(12), { type: 'intervals', reps: 5, onSec: 300, onPct: 103, offSec: 180, offPct: 55 }, COOL(8)],
  },
  {
    id: 'builtin-overunder-3x12', name: 'Über/Unter 3×12', source: 'builtin', tags: ['Schwelle', 'Z4'],
    description: 'Drei Blöcke, die alle 3 min zwischen 95 % und 105 % FTP wechseln. Lehrt, Laktat zu verarbeiten.',
    segments: [WARM(12), ...overUnderBlock(12, 95, 105), REST(5), ...overUnderBlock(12, 95, 105), REST(5), ...overUnderBlock(12, 95, 105), COOL(8)],
  },
  {
    id: 'builtin-vo2max-4x4', name: 'VO2max 4×4', source: 'builtin', tags: ['VO2max', 'Z5'],
    description: 'Vier Blöcke à 4 min bei 112 % FTP, 4 min locker dazwischen. Sehr hart, aber kurz.',
    segments: [WARM(15), { type: 'intervals', reps: 4, onSec: 240, onPct: 112, offSec: 240, offPct: 50 }, COOL(8)],
  },
  {
    id: 'builtin-vo2max-6x3', name: 'VO2max 6×3', source: 'builtin', tags: ['VO2max', 'Z5'],
    description: 'Sechs Blöcke à 3 min bei 118 % FTP mit gleich langer Pause.',
    segments: [WARM(15), { type: 'intervals', reps: 6, onSec: 180, onPct: 118, offSec: 180, offPct: 50 }, COOL(8)],
  },
  {
    id: 'builtin-3030-2x10', name: 'Kurzintervalle 30/30', source: 'builtin', tags: ['VO2max', 'Z5'],
    description: 'Zwei Sätze mit je 10× (30 s hart, 30 s locker). Reizt die VO2max mit wenig Ermüdung pro Intervall.',
    segments: [
      WARM(12),
      { type: 'intervals', reps: 10, onSec: 30, onPct: 125, offSec: 30, offPct: 50 }, REST(5, 50),
      { type: 'intervals', reps: 10, onSec: 30, onPct: 125, offSec: 30, offPct: 50 }, COOL(8),
    ],
  },
  {
    id: 'builtin-pyramide', name: 'Pyramide 1-2-3-4-3-2-1', source: 'builtin', tags: ['VO2max', 'Z4'],
    description: 'Blöcke von 1 bis 4 min und wieder zurück bei 105 % FTP, jeweils gleich lange Erholung.',
    segments: [WARM(12), ...pyramid(105, 55), COOL(8)],
  },
  {
    id: 'builtin-ftp-test-20', name: 'FTP-Test 20 min', source: 'builtin', tags: ['Test'],
    description: 'Klassischer 20-Minuten-Test: nach Aufwärmen und kurzem Anreißen 20 min so hart wie gleichmäßig möglich fahren. FTP ≈ 95 % der Durchschnittsleistung.',
    segments: [
      WARM(10),
      { type: 'intervals', reps: 3, onSec: 60, onPct: 100, offSec: 60, offPct: 50 },
      REST(5, 50),
      { type: 'freeride', sec: 300 }, REST(10, 50),
      { type: 'freeride', sec: 1200 },
      COOL(10),
    ],
  },
]

export const BUILTIN_WORKOUTS: Workout[] = [...BASE_WORKOUTS, ...EXTRA_WORKOUTS]
