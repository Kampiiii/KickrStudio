// FTMS-Trainer-Client (Fitness Machine Service) mit Auto-Reconnect.
// Fallback auf Cycling Power Service (nur Lesen) wenn kein FTMS vorhanden.
import type { ConnState, TrainerClient, TrainerData } from './types'

const FTMS_SERVICE = 0x1826
const INDOOR_BIKE_DATA = 0x2ad2
const CONTROL_POINT = 0x2ad9
const CPS_SERVICE = 0x1818
const CPS_MEASUREMENT = 0x2a63

const OP_REQUEST_CONTROL = 0x00
const OP_SET_TARGET_POWER = 0x05

export class FtmsTrainer implements TrainerClient {
  name = ''
  kind: 'ftms' | 'power' = 'ftms'
  private device: BluetoothDevice | null = null
  private controlPoint: BluetoothRemoteGATTCharacteristic | null = null
  private dataCb: (d: TrainerData) => void = () => {}
  private stateCb: (s: ConnState) => void = () => {}
  private state: ConnState = 'disconnected'
  private lastTarget: number | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private intentionalDisconnect = false
  // Kadenz aus CPS-Kurbelumdrehungen ableiten (Fallback-Modus)
  private lastCrank: { revs: number; time: number } | null = null
  private cadenceFromCps: number | null = null

  onData(cb: (d: TrainerData) => void) { this.dataCb = cb }
  onStateChange(cb: (s: ConnState) => void) { this.stateCb = cb }

  private setState(s: ConnState) { this.state = s; this.stateCb(s) }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false
    this.setState('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }, { services: [CPS_SERVICE] }],
        optionalServices: [FTMS_SERVICE, CPS_SERVICE],
      })
      this.name = this.device.name || 'Trainer'
      this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect())
      await this.setup()
      this.setState('connected')
    } catch (e) {
      this.setState('disconnected')
      throw e
    }
  }

  private async setup(): Promise<void> {
    const server = await this.device!.gatt!.connect()
    try {
      const svc = await server.getPrimaryService(FTMS_SERVICE)
      this.kind = 'ftms'
      const bikeData = await svc.getCharacteristic(INDOOR_BIKE_DATA)
      await bikeData.startNotifications()
      bikeData.addEventListener('characteristicvaluechanged', (ev) => {
        this.dataCb(parseIndoorBikeData((ev.target as BluetoothRemoteGATTCharacteristic).value!))
      })
      try {
        this.controlPoint = await svc.getCharacteristic(CONTROL_POINT)
        await this.controlPoint.startNotifications()
        await this.writeCp(new Uint8Array([OP_REQUEST_CONTROL]))
      } catch {
        this.controlPoint = null
      }
    } catch {
      // Kein FTMS → Cycling Power Service, nur Messwerte
      const svc = await server.getPrimaryService(CPS_SERVICE)
      this.kind = 'power'
      this.controlPoint = null
      const meas = await svc.getCharacteristic(CPS_MEASUREMENT)
      await meas.startNotifications()
      meas.addEventListener('characteristicvaluechanged', (ev) => {
        this.dataCb(this.parseCps((ev.target as BluetoothRemoteGATTCharacteristic).value!))
      })
    }
    // Nach (Re-)Connect zuletzt gesetzten ERG-Sollwert wiederherstellen
    if (this.lastTarget != null && this.controlPoint) {
      await this.sendTargetPower(this.lastTarget).catch(() => {})
    }
  }

  private handleDisconnect() {
    if (this.intentionalDisconnect) { this.setState('disconnected'); return }
    this.reconnect()
  }

  private async reconnect() {
    this.setState('reconnecting')
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      if (this.intentionalDisconnect) return
      try {
        await this.setup()
        this.setState('connected')
        return
      } catch { /* nächster Versuch */ }
    }
    this.setState('disconnected')
  }

  disconnect() {
    this.intentionalDisconnect = true
    try { this.device?.gatt?.disconnect() } catch { }
    this.setState('disconnected')
  }

  get canControl(): boolean { return this.controlPoint != null }

  async setTargetPower(watts: number): Promise<void> {
    this.lastTarget = Math.max(0, Math.round(watts))
    if (!this.controlPoint || this.state !== 'connected') return
    await this.sendTargetPower(this.lastTarget)
  }

  private sendTargetPower(watts: number): Promise<void> {
    const buf = new Uint8Array(3)
    buf[0] = OP_SET_TARGET_POWER
    new DataView(buf.buffer).setInt16(1, watts, true)
    return this.writeCp(buf)
  }

  // GATT erlaubt nur eine Operation gleichzeitig → Writes serialisieren
  private writeCp(data: Uint8Array): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() => this.controlPoint?.writeValueWithResponse(data as unknown as BufferSource))
      .catch(() => {})
    return this.writeQueue
  }

  private parseCps(dv: DataView): TrainerData {
    const flags = dv.getUint16(0, true)
    let offset = 2
    const power = dv.getInt16(offset, true); offset += 2
    if (flags & 0x0001) offset += 1 // pedal power balance
    if (flags & 0x0004) offset += 2 // accumulated torque
    if (flags & 0x0010) offset += 6 // wheel revolution data
    if (flags & 0x0020) {
      const revs = dv.getUint16(offset, true)
      const time = dv.getUint16(offset + 2, true) // 1/1024 s
      if (this.lastCrank) {
        const dRevs = (revs - this.lastCrank.revs + 0x10000) % 0x10000
        const dTime = (time - this.lastCrank.time + 0x10000) % 0x10000
        if (dTime > 0 && dRevs > 0) this.cadenceFromCps = Math.round((dRevs * 1024 * 60) / dTime)
        else if (dRevs === 0) this.cadenceFromCps = 0
      }
      this.lastCrank = { revs, time }
    }
    return { power, cadence: this.cadenceFromCps, speedKmh: null }
  }
}

export function parseIndoorBikeData(dv: DataView): TrainerData {
  const flags = dv.getUint16(0, true)
  let offset = 2
  let speedKmh: number | null = null
  let cadence: number | null = null
  let power: number | null = null
  if (!(flags & 0x0001)) { speedKmh = dv.getUint16(offset, true) / 100; offset += 2 } // Instantaneous Speed
  if (flags & 0x0002) offset += 2 // Average Speed
  if (flags & 0x0004) { cadence = dv.getUint16(offset, true) / 2; offset += 2 } // Instantaneous Cadence
  if (flags & 0x0008) offset += 2 // Average Cadence
  if (flags & 0x0010) offset += 3 // Total Distance
  if (flags & 0x0020) offset += 2 // Resistance Level
  if (flags & 0x0040) { power = dv.getInt16(offset, true); offset += 2 } // Instantaneous Power
  return { power, cadence, speedKmh }
}
