// Zentraler App-Zustand (außerhalb von React) + useApp()-Hook.
import { useSyncExternalStore } from 'react'
import type { Workout, Step } from './engine/model'
import type { Sample } from './engine/metrics'
import type { Settings, Session, SessionMeta, QueuedWorkout } from './bridge'
import type { ConnState } from './ble/types'

export type Page = 'train' | 'workouts' | 'history' | 'settings'

export interface Telemetry {
  power: number | null
  cadence: number | null
  speedKmh: number | null
  hr: number | null
  lastDataAt: number
}

export interface PlayerState {
  status: 'idle' | 'riding' | 'paused' | 'finished'
  workout: Workout | null
  steps: Step[]
  elapsed: number
  trimPct: number
  freerideTarget: number
  currentTarget: number
  samples: Sample[]
  startedAt: string | null
  pausedByDisconnect: boolean
}

export interface AppState {
  page: Page
  settings: Settings | null
  workouts: Workout[]
  sessions: SessionMeta[]
  queued: QueuedWorkout | null
  trainerState: ConnState
  trainerName: string
  trainerControl: boolean
  hrState: ConnState
  hrName: string
  telemetry: Telemetry
  dataStale: boolean
  chooserDevices: { id: string; name: string }[] | null
  chooserFor: 'trainer' | 'hr' | null
  player: PlayerState
  selectedWorkout: Workout | null
  lastFinished: Session | null
  ftpSuggestion: number | null
  toast: { text: string; kind: 'ok' | 'err' } | null
}

const initialState: AppState = {
  page: 'train',
  settings: null,
  workouts: [],
  sessions: [],
  queued: null,
  trainerState: 'disconnected',
  trainerName: '',
  trainerControl: false,
  hrState: 'disconnected',
  hrName: '',
  telemetry: { power: null, cadence: null, speedKmh: null, hr: null, lastDataAt: 0 },
  dataStale: false,
  chooserDevices: null,
  chooserFor: null,
  player: {
    status: 'idle', workout: null, steps: [], elapsed: 0, trimPct: 0,
    freerideTarget: 120, currentTarget: 0, samples: [], startedAt: null, pausedByDisconnect: false,
  },
  selectedWorkout: null,
  lastFinished: null,
  ftpSuggestion: null,
  toast: null,
}

let state: AppState = initialState
const listeners = new Set<() => void>()

export function getState(): AppState { return state }

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch
  state = { ...state, ...p }
  listeners.forEach(l => l())
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useApp(): AppState {
  return useSyncExternalStore(subscribe, getState)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
export function showToast(text: string, kind: 'ok' | 'err' = 'ok') {
  setState({ toast: { text, kind } })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setState({ toast: null }), 4500)
}
