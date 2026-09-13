// Modal mit der Live-Scan-Liste aus dem Electron-Main-Prozess.
import { useApp } from '../state'
import { chooserPick, chooserCancel } from '../ble/manager'

export default function DevicePicker() {
  const { chooserFor, chooserDevices } = useApp()
  if (!chooserFor) return null
  const devices = (chooserDevices || []).filter(d => d.name)
  return (
    <div className="modal-backdrop" onClick={chooserCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>{chooserFor === 'trainer' ? 'Trainer suchen' : 'Herzfrequenzgurt suchen'}</h3>
        <div className="scanning"><div className="spinner" /> Suche nach Bluetooth-Geräten … {chooserFor === 'trainer' ? 'Wecke den Kickr ggf. durch Kurbeln auf.' : 'Gurt anlegen und Kontakte befeuchten.'}</div>
        <div className="device-list">
          {devices.length === 0 && <div className="hint" style={{ padding: '20px 0', textAlign: 'center' }}>Noch keine Geräte gefunden …</div>}
          {devices.map(d => (
            <div key={d.id} className="device-item" onClick={() => chooserPick(d.id)}>
              <span style={{ fontSize: 18 }}>{chooserFor === 'trainer' ? '🚴' : '❤️'}</span>
              <span>{d.name}</span>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={chooserCancel}>Abbrechen</button>
        </div>
      </div>
    </div>
  )
}
