// Simulator: voll funktionsfähiger virtueller Trainer + HF-Gurt.
// Erzeugt plausible Werte um den ERG-Sollwert — zum Testen ohne Hardware.
import type { ConnState, HrClient, TrainerClient, TrainerData } from './types'

// Gemeinsamer Zustand, damit die simulierte HF der Leistung folgt
const simState = { watts: 0, hr: 70 }

export class SimulatorTrainer implements TrainerClient {
  name = 'Simulator-Trainer'
  kind = 'simulator' as const
  private timer: ReturnType<typeof setInterval> | null = null
  private target = 120
  private dataCb: (d: TrainerData) => void = () => {}
  private stateCb: (s: ConnState) => void = () => {}

  onData(cb: (d: TrainerData) => void) { this.dataCb = cb }
  onStateChange(cb: (s: ConnState) => void) { this.stateCb = cb }

  async connect(): Promise<void> {
    this.stateCb('connecting')
    await new Promise(r => setTimeout(r, 400))
    this.timer = setInterval(() => {
      const noise = (Math.random() - 0.5) * 0.08 * Math.max(60, this.target)
      const power = Math.max(0, Math.round(this.target + noise))
      simState.watts = power
      const cadence = this.target > 0 ? Math.round(88 + (Math.random() - 0.5) * 6) : 0
      this.dataCb({ power, cadence, speedKmh: Math.round(power * 0.135 * 10) / 10 })
    }, 1000)
    this.stateCb('connected')
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    simState.watts = 0
    this.stateCb('disconnected')
  }

  async setTargetPower(watts: number): Promise<void> {
    this.target = Math.max(0, Math.round(watts))
  }
}

export class SimulatorHr implements HrClient {
  name = 'Simulator-HF'
  private timer: ReturnType<typeof setInterval> | null = null
  private dataCb: (bpm: number) => void = () => {}
  private stateCb: (s: ConnState) => void = () => {}

  onData(cb: (bpm: number) => void) { this.dataCb = cb }
  onStateChange(cb: (s: ConnState) => void) { this.stateCb = cb }

  async connect(): Promise<void> {
    this.stateCb('connecting')
    await new Promise(r => setTimeout(r, 300))
    this.timer = setInterval(() => {
      // HF driftet träge Richtung eines leistungsabhängigen Zielwerts
      const targetHr = 62 + Math.min(120, simState.watts * 0.42)
      simState.hr += (targetHr - simState.hr) * 0.05 + (Math.random() - 0.5) * 1.5
      this.dataCb(Math.round(simState.hr))
    }, 1000)
    this.stateCb('connected')
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stateCb('disconnected')
  }
}
