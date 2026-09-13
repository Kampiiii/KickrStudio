// BLE-Herzfrequenzgurt (Heart Rate Service) mit Auto-Reconnect.
import type { ConnState, HrClient } from './types'

const HR_SERVICE = 0x180d
const HR_MEASUREMENT = 0x2a37

export class BleHeartRate implements HrClient {
  name = ''
  private device: BluetoothDevice | null = null
  private dataCb: (bpm: number) => void = () => {}
  private stateCb: (s: ConnState) => void = () => {}
  private intentionalDisconnect = false

  onData(cb: (bpm: number) => void) { this.dataCb = cb }
  onStateChange(cb: (s: ConnState) => void) { this.stateCb = cb }

  async connect(): Promise<void> {
    this.intentionalDisconnect = false
    this.stateCb('connecting')
    try {
      this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] })
      this.name = this.device.name || 'HF-Gurt'
      this.device.addEventListener('gattserverdisconnected', () => {
        if (!this.intentionalDisconnect) this.reconnect()
        else this.stateCb('disconnected')
      })
      await this.setup()
      this.stateCb('connected')
    } catch (e) {
      this.stateCb('disconnected')
      throw e
    }
  }

  private async setup() {
    const server = await this.device!.gatt!.connect()
    const svc = await server.getPrimaryService(HR_SERVICE)
    const meas = await svc.getCharacteristic(HR_MEASUREMENT)
    await meas.startNotifications()
    meas.addEventListener('characteristicvaluechanged', (ev) => {
      const dv = (ev.target as BluetoothRemoteGATTCharacteristic).value!
      const flags = dv.getUint8(0)
      const bpm = (flags & 0x01) ? dv.getUint16(1, true) : dv.getUint8(1)
      this.dataCb(bpm)
    })
  }

  private async reconnect() {
    this.stateCb('reconnecting')
    for (let attempt = 1; attempt <= 3; attempt++) {
      await new Promise(r => setTimeout(r, attempt * 2000))
      if (this.intentionalDisconnect) return
      try {
        await this.setup()
        this.stateCb('connected')
        return
      } catch { }
    }
    this.stateCb('disconnected')
  }

  disconnect() {
    this.intentionalDisconnect = true
    try { this.device?.gatt?.disconnect() } catch { }
    this.stateCb('disconnected')
  }
}
