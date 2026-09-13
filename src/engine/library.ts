import type { Workout } from './model'

// Eingebaute Programme — alle Ziele in %FTP, skalieren automatisch mit der FTP.
export const BUILTIN_WORKOUTS: Workout[] = [
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
