// Cloud-Sync mit Doppelstart-Schutz: Läuft schon ein Sync (z.B. automatisch nach der Einheit),
// wartet ein zweiter Aufruf auf dasselbe Ergebnis, statt einen weiteren zu starten.
import { bridge } from '../bridge'
import { setState, showToast } from '../state'

type SyncResult = Awaited<ReturnType<typeof bridge.cloudSync>>
let running: Promise<SyncResult> | null = null

export async function runCloudSync(): Promise<SyncResult> {
  if (!running) running = bridge.cloudSync().finally(() => { running = null })
  const r = await running
  if (r.ok) {
    setState({ sessions: await bridge.listSessions() })
    showToast(`Cloud synchronisiert: ${r.uploadedSessions} neue Einheit(en), ${r.bodyRows} Körperdaten, ${r.planRows} Planeinträge (${r.seconds} s)`)
  } else {
    showToast('Cloud-Sync fehlgeschlagen: ' + (r.error || 'unbekannter Fehler'), 'err')
  }
  return r
}
