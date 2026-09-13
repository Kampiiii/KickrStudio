export interface TrainerData {
  power: number | null
  cadence: number | null
  speedKmh: number | null
}

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export interface TrainerClient {
  readonly name: string
  readonly kind: 'ftms' | 'power' | 'simulator'
  connect(): Promise<void>
  disconnect(): void
  setTargetPower(watts: number): Promise<void>
  onData(cb: (d: TrainerData) => void): void
  onStateChange(cb: (s: ConnState) => void): void
}

export interface HrClient {
  readonly name: string
  connect(): Promise<void>
  disconnect(): void
  onData(cb: (bpm: number) => void): void
  onStateChange(cb: (s: ConnState) => void): void
}
