// Brücke zum Electron-Main-Prozess. Läuft die App im normalen Browser
// (z.B. Vite-Dev ohne Electron), springt ein localStorage-Mock ein,
// damit UI und Simulator voll testbar sind.
import type { Workout } from './engine/model'

export interface Settings {
  ftp: number
  ftpHistory: { date: string; ftp: number }[]
  weightKg: number
  hrMax: number
  hrRest: number
  powerZones: { name: string; pctHigh: number }[]
  strava: { clientId: string; clientSecret: string; accessToken: string; refreshToken: string; expiresAt: number; athleteName: string }
  erg: { smoothingSec: number; trimStepPct: number; resendIntervalSec: number }
  devices: { trainer: { name: string } | null; hr: { name: string } | null }
  autoConnect: boolean
  httpPort: number
}

export interface SessionMeta {
  id: string
  name: string
  workoutId?: string
  startedAt: string
  durationSec: number
  ftpAtTime: number
  summary: {
    avgPower: number; maxPower: number; np: number; if: number; tss: number; kj: number
    avgHr: number | null; maxHr: number | null; avgCadence: number | null
    zoneSeconds: number[]; best60s: number
  }
  stravaActivityId?: number | null
  uploadedAt?: string
}

export interface Session extends SessionMeta {
  samples: { t: number; power: number; hr: number | null; cadence: number | null; target: number }[]
}

export interface QueuedWorkout { workout: Workout; note?: string; queuedAt: string }

export interface KickrBridge {
  onBleDevices(cb: (devices: { id: string; name: string }[]) => void): () => void
  bleSelect(deviceId: string): void
  bleCancel(): void
  getSettings(): Promise<Settings>
  setSettings(s: Settings): Promise<Settings>
  listWorkouts(): Promise<Workout[]>
  saveWorkout(w: Workout): Promise<Workout>
  deleteWorkout(id: string): Promise<boolean>
  listSessions(): Promise<SessionMeta[]>
  getSession(id: string): Promise<Session | null>
  saveSession(s: Session): Promise<Session>
  deleteSession(id: string): Promise<boolean>
  getQueuedWorkout(): Promise<QueuedWorkout | null>
  clearQueuedWorkout(): Promise<boolean>
  snapshotBuiltins?(list: Workout[]): Promise<boolean>
  onDataChanged(cb: () => void): () => void
  exportTcx(sessionId: string): Promise<{ ok: boolean; filePath?: string; error?: string; canceled?: boolean }>
  stravaConnect(): Promise<{ ok: boolean; athleteName?: string; error?: string }>
  stravaDisconnect(): Promise<boolean>
  stravaUpload(sessionId: string): Promise<{ ok: boolean; activityId?: number | null; pending?: boolean; error?: string }>
  appInfo(): Promise<{ dataDir: string; mcpServerPath: string; nodeHint: string; version: string }>
  openExternal(url: string): Promise<void>
  openDataDir(): Promise<void>
  keepAwake(on: boolean): Promise<boolean>
}

declare global {
  interface Window { kickr?: KickrBridge }
}

export const isElectron = typeof window !== 'undefined' && !!window.kickr

function ls<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function lsSet(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)) }

const DEFAULT_SETTINGS: Settings = {
  ftp: 200, ftpHistory: [], weightKg: 78, hrMax: 185, hrRest: 55,
  powerZones: [
    { name: 'Z1 Regeneration', pctHigh: 55 }, { name: 'Z2 Grundlage', pctHigh: 75 },
    { name: 'Z3 Tempo', pctHigh: 90 }, { name: 'Z4 Schwelle', pctHigh: 105 },
    { name: 'Z5 VO2max', pctHigh: 120 }, { name: 'Z6 Anaerob', pctHigh: 150 },
    { name: 'Z7 Sprint', pctHigh: 999 },
  ],
  strava: { clientId: '', clientSecret: '', accessToken: '', refreshToken: '', expiresAt: 0, athleteName: '' },
  erg: { smoothingSec: 3, trimStepPct: 5, resendIntervalSec: 10 },
  devices: { trainer: null, hr: null },
  autoConnect: true,
  httpPort: 4571,
}

const browserMock: KickrBridge = {
  onBleDevices: () => () => {},
  bleSelect: () => {},
  bleCancel: () => {},
  getSettings: async () => ({ ...DEFAULT_SETTINGS, ...ls('ks-settings', {}) }),
  setSettings: async (s) => { lsSet('ks-settings', s); return s },
  listWorkouts: async () => ls('ks-workouts', []),
  saveWorkout: async (w) => {
    if (!w.id) w.id = 'w-' + Date.now().toString(36)
    const all = ls<Workout[]>('ks-workouts', []).filter(x => x.id !== w.id)
    all.push(w); lsSet('ks-workouts', all); return w
  },
  deleteWorkout: async (id) => { lsSet('ks-workouts', ls<Workout[]>('ks-workouts', []).filter(x => x.id !== id)); return true },
  listSessions: async () => ls<Session[]>('ks-sessions', []).map(({ samples, ...meta }) => meta).sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  getSession: async (id) => ls<Session[]>('ks-sessions', []).find(s => s.id === id) || null,
  saveSession: async (s) => {
    if (!s.id) s.id = s.startedAt.replace(/[:.]/g, '-') + '__' + s.name.toLowerCase().replace(/\W+/g, '-')
    const all = ls<Session[]>('ks-sessions', []).filter(x => x.id !== s.id)
    all.push(s); lsSet('ks-sessions', all); return s
  },
  deleteSession: async (id) => { lsSet('ks-sessions', ls<Session[]>('ks-sessions', []).filter(x => x.id !== id)); return true },
  getQueuedWorkout: async () => ls('ks-queued', null),
  clearQueuedWorkout: async () => { localStorage.removeItem('ks-queued'); return true },
  onDataChanged: () => () => {},
  exportTcx: async () => ({ ok: false, error: 'TCX-Export nur in der Desktop-App verfügbar.' }),
  stravaConnect: async () => ({ ok: false, error: 'Strava nur in der Desktop-App verfügbar.' }),
  stravaDisconnect: async () => true,
  stravaUpload: async () => ({ ok: false, error: 'Strava nur in der Desktop-App verfügbar.' }),
  appInfo: async () => ({ dataDir: '(Browser-Modus)', mcpServerPath: '(Browser-Modus)', nodeHint: 'node', version: '0.1.0-dev' }),
  openExternal: async (url) => { window.open(url, '_blank') },
  openDataDir: async () => {},
  keepAwake: async () => true,
}

export const bridge: KickrBridge = (typeof window !== 'undefined' && window.kickr) ? window.kickr : browserMock
