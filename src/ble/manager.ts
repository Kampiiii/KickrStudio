// Verbindungs-Manager: hält Trainer- und HF-Client, verdrahtet Telemetrie
// mit dem App-Zustand, überwacht den Datenfluss (Watchdog).
import { FtmsTrainer } from './ftms'
import { BleHeartRate } from './hr'
import { SimulatorTrainer, SimulatorHr } from './simulator'
import type { TrainerClient, HrClient } from './types'
import { bridge } from '../bridge'
import { getState, setState, showToast } from '../state'

let trainer: TrainerClient | null = null
let hr: HrClient | null = null

// Chooser-Liste aus dem Main-Prozess (Electron) in den Zustand spiegeln
bridge.onBleDevices((devices) => {
  setState({ chooserDevices: devices })
})

export function chooserPick(id: string) {
  bridge.bleSelect(id)
  setState({ chooserDevices: null, chooserFor: null })
}

export function chooserCancel() {
  bridge.bleCancel()
  setState({ chooserDevices: null, chooserFor: null })
}

export async function connectTrainer(sim = false): Promise<void> {
  disconnectTrainer()
  const t: TrainerClient = sim ? new SimulatorTrainer() : new FtmsTrainer()
  trainer = t
  t.onStateChange((s) => {
    setState({
      trainerState: s,
      trainerName: t.name,
      trainerControl: t.kind !== 'power',
    })
    if (s === 'connected') showToast(`Trainer verbunden: ${t.name}`)
    if (s === 'reconnecting') showToast('Trainer-Verbindung verloren – versuche Reconnect …', 'err')
  })
  t.onData((d) => {
    setState(st => ({
      telemetry: {
        ...st.telemetry,
        power: d.power,
        cadence: d.cadence ?? st.telemetry.cadence,
        speedKmh: d.speedKmh ?? st.telemetry.speedKmh,
        lastDataAt: Date.now(),
      },
      dataStale: false,
    }))
  })
  if (!sim) setState({ chooserFor: 'trainer' })
  try {
    await t.connect()
    const s = getState().settings
    if (s) {
      s.devices = { ...s.devices, trainer: { name: t.name } }
      bridge.setSettings(s)
    }
  } finally {
    setState({ chooserDevices: null, chooserFor: null })
  }
}

export async function connectHr(sim = false): Promise<void> {
  disconnectHr()
  const h: HrClient = sim ? new SimulatorHr() : new BleHeartRate()
  hr = h
  h.onStateChange((s) => {
    setState({ hrState: s, hrName: h.name })
    if (s === 'connected') showToast(`HF-Gurt verbunden: ${h.name}`)
  })
  h.onData((bpm) => {
    setState(st => ({ telemetry: { ...st.telemetry, hr: bpm } }))
  })
  if (!sim) setState({ chooserFor: 'hr' })
  try {
    await h.connect()
    const s = getState().settings
    if (s) {
      s.devices = { ...s.devices, hr: { name: h.name } }
      bridge.setSettings(s)
    }
  } finally {
    setState({ chooserDevices: null, chooserFor: null })
  }
}

export function disconnectTrainer() {
  trainer?.disconnect()
  trainer = null
  setState({ trainerState: 'disconnected', trainerName: '', trainerControl: false })
}

export function disconnectHr() {
  hr?.disconnect()
  hr = null
  setState(st => ({ hrState: 'disconnected', hrName: '', telemetry: { ...st.telemetry, hr: null } }))
}

export async function setTargetPower(watts: number): Promise<void> {
  if (trainer) await trainer.setTargetPower(watts)
}

// Watchdog: >5 s keine Trainer-Daten trotz Verbindung → Warnung im UI
setInterval(() => {
  const st = getState()
  if (st.trainerState === 'connected' && st.telemetry.lastDataAt > 0) {
    const stale = Date.now() - st.telemetry.lastDataAt > 5000
    if (stale !== st.dataStale) setState({ dataStale: stale })
  }
}, 1000)
