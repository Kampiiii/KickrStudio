const { app, BrowserWindow, ipcMain, shell, dialog, powerSaveBlocker } = require('electron')
const path = require('path')
const fs = require('fs')
const store = require('./store.cjs')
const strava = require('./strava.cjs')
const withings = require('./withings.cjs')
const backup = require('./backup.cjs')
const { sessionToTcx } = require('./tcx.cjs')

let win = null
let bleSelectCallback = null
let psbId = null
let playerStatus = 'idle'
let allowClose = false

// Nur eine laufende Instanz zulassen — zwei Fenster gleichzeitig auf denselben
// Datenordner können sich beim Schreiben/Lesen von settings.json & Co. überschneiden
// und dadurch kurzzeitig leer/unvollständig wirken. Ein zweiter Start fokussiert
// stattdessen einfach das bestehende Fenster.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  return
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    title: 'KickrStudio',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  // Eigene Geräteauswahl: Chromium liefert die Scan-Liste hierher, wir zeigen sie im Renderer an.
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault()
    bleSelectCallback = callback
    win.webContents.send('ble:devices', devices.map(d => ({ id: d.deviceId, name: d.deviceName || '' })))
  })

  win.webContents.session.setBluetoothPairingHandler((details, callback) => {
    // Kickr/HF-Gurte brauchen i.d.R. kein Pairing; falls doch, automatisch bestätigen.
    if (details.pairingKind === 'confirm') callback({ confirmed: true })
    else callback({ confirmed: false })
  })

  win.webContents.session.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'bluetooth' || permission === 'hid' || permission === 'notifications')
  })
  win.webContents.session.setPermissionCheckHandler(() => true)

  // Vor versehentlichem Datenverlust warnen, wenn beim Schließen noch ein
  // Workout läuft (Aufzeichnung existiert bis "Beenden" nur im Renderer-Speicher).
  win.on('close', (e) => {
    if (allowClose || (playerStatus !== 'riding' && playerStatus !== 'paused')) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Abbrechen', 'Trotzdem schließen'],
      defaultId: 0,
      cancelId: 0,
      title: 'Workout läuft noch',
      message: 'Ein Workout läuft noch und ist noch nicht gespeichert.',
      detail: 'Beende das Workout zuerst über „■ Beenden", damit die Aufzeichnung gespeichert wird. Ein Zwischenstand wurde automatisch gesichert, falls doch etwas schiefgeht.',
    })
    if (choice === 1) { allowClose = true; win.close() }
  })

  if (process.env.VITE_DEV) {
    const tryLoad = (attempt = 0) => {
      win.loadURL('http://localhost:5173').catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500)
      })
    }
    tryLoad()
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ---------- IPC: Bluetooth-Auswahl ----------
ipcMain.on('ble:select', (_e, deviceId) => {
  if (bleSelectCallback) { try { bleSelectCallback(deviceId) } catch { } bleSelectCallback = null }
})
ipcMain.on('ble:cancel', () => {
  if (bleSelectCallback) { try { bleSelectCallback('') } catch { } bleSelectCallback = null }
})

// ---------- IPC: Daten ----------
ipcMain.handle('settings:get', () => store.getSettings())
ipcMain.handle('settings:set', (_e, s) => { store.saveSettings(s); return store.getSettings() })
ipcMain.handle('workouts:list', () => store.listWorkouts())
ipcMain.handle('workouts:save', (_e, w) => store.saveWorkout(w))
ipcMain.handle('workouts:delete', (_e, id) => { store.deleteWorkout(id); return true })
ipcMain.handle('sessions:list', () => store.listSessions())
ipcMain.handle('sessions:get', (_e, id) => store.getSession(id))
ipcMain.handle('sessions:save', (_e, s) => store.saveSession(s))
ipcMain.handle('sessions:delete', (_e, id) => { store.deleteSession(id); return true })
ipcMain.on('player:status', (_e, status) => { playerStatus = status })
ipcMain.handle('draft:get', () => store.getDraftSession())
ipcMain.handle('draft:save', (_e, draft) => { store.saveDraftSession(draft); return true })
ipcMain.handle('draft:clear', () => { store.clearDraftSession(); return true })

ipcMain.handle('queue:get', () => store.getQueuedWorkout())
ipcMain.handle('builtins:snapshot', (_e, list) => {
  // Snapshot der eingebauten Programme für den MCP-Server (liest nur Dateien)
  store.ensureDirs()
  fs.writeFileSync(path.join(store.DATA_DIR, 'builtin-workouts.json'), JSON.stringify(list, null, 2))
  return true
})
ipcMain.handle('queue:clear', () => { store.setQueuedWorkout(null); return true })
ipcMain.handle('app:info', () => ({
  dataDir: store.DATA_DIR,
  mcpServerPath: path.join(app.getAppPath(), 'mcp', 'server.mjs'),
  nodeHint: process.execPath,
  version: app.getVersion(),
}))
ipcMain.handle('app:openExternal', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url)
})
ipcMain.handle('app:openDataDir', () => shell.openPath(store.DATA_DIR))

// ---------- IPC: Wach bleiben während des Trainings ----------
ipcMain.handle('power:keepAwake', (_e, on) => {
  if (on && psbId === null) psbId = powerSaveBlocker.start('prevent-display-sleep')
  if (!on && psbId !== null) { powerSaveBlocker.stop(psbId); psbId = null }
  return true
})

// ---------- IPC: Export & Strava ----------
ipcMain.handle('export:tcx', async (_e, sessionId) => {
  const session = store.getSession(sessionId)
  if (!session) return { ok: false, error: 'Session nicht gefunden.' }
  const settings = store.getSettings()
  const tcx = sessionToTcx(session, settings.weightKg)
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), `${session.id}.tcx`),
    filters: [{ name: 'TCX', extensions: ['tcx'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  fs.writeFileSync(filePath, tcx)
  return { ok: true, filePath }
})

ipcMain.handle('withings:connect', () => withings.connect())
ipcMain.handle('withings:disconnect', () => { withings.disconnect(); return true })
ipcMain.handle('withings:sync', async () => {
  try { return await withings.sync() }
  catch (e) { return { ok: false, error: String(e.message || e) } }
})
ipcMain.handle('body:list', () => store.listBody())

// ---------- IPC: Backup ----------
ipcMain.handle('backup:create', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'KickrStudio-Backup speichern',
    defaultPath: path.join(app.getPath('documents'), `kickrstudio-backup-${new Date().toISOString().slice(0, 10)}.zip`),
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
  })
  if (canceled || !filePath) return { ok: false, canceled: true }
  try {
    const r = await backup.createBackupZip(filePath)
    return { ok: true, filePath: r.path, sizeBytes: r.size }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})
ipcMain.handle('backup:restore', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'KickrStudio-Backup wiederherstellen',
    properties: ['openFile'],
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
  })
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true }
  try {
    await backup.restoreBackupZip(filePaths[0])
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})
ipcMain.handle('backup:listAuto', () => backup.listAutoBackups())
ipcMain.handle('backup:openFolder', () => { fs.mkdirSync(backup.BACKUP_DIR, { recursive: true }); shell.openPath(backup.BACKUP_DIR) })
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0) })
ipcMain.handle('plan:list', () => store.listPlan())
ipcMain.handle('plan:save', (_e, entry) => store.savePlanEntry(entry))
ipcMain.handle('plan:delete', (_e, id) => { store.deletePlanEntry(id); return true })

ipcMain.handle('strava:connect', () => strava.connect())
ipcMain.handle('strava:disconnect', () => { strava.disconnect(); return true })
ipcMain.handle('strava:upload', async (_e, sessionId) => {
  try {
    const session = store.getSession(sessionId)
    if (!session) return { ok: false, error: 'Session nicht gefunden.' }
    const settings = store.getSettings()
    const tcx = sessionToTcx(session, settings.weightKg)
    const sum = session.summary || {}
    const desc = `KickrStudio · NP ${Math.round(sum.np || 0)} W · IF ${(sum.if || 0).toFixed(2)} · TSS ${Math.round(sum.tss || 0)} · FTP ${session.ftpAtTime || settings.ftp} W`
    const res = await strava.uploadTcx(tcx, session.name || 'KickrStudio Workout', desc)
    store.updateSession(sessionId, { stravaActivityId: res.activityId, uploadedAt: new Date().toISOString() })
    return { ok: true, ...res }
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
})

// ---------- Dateiänderungen (MCP-Server schreibt Workouts/Queue) ----------
function watchData() {
  store.ensureDirs()
  const notify = () => { if (win && !win.isDestroyed()) win.webContents.send('data:changed') }
  let t = null
  const debounced = () => { clearTimeout(t); t = setTimeout(notify, 300) }
  try { fs.watch(store.WORKOUTS_DIR, debounced) } catch { }
  try { fs.watch(store.DATA_DIR, (ev, f) => { if (f === 'queued-workout.json' || f === 'settings.json' || f === 'plan.json') debounced() }) } catch { }
}

// Beim Start still die Waage synchronisieren (falls verbunden)
function autoSyncWithings() {
  const s = store.getSettings()
  if (!s.withings.refreshToken) return
  withings.sync()
    .then(() => { if (win && !win.isDestroyed()) win.webContents.send('data:changed') })
    .catch(() => { })
}

app.whenReady().then(() => {
  createWindow()
  watchData()
  autoSyncWithings()
  backup.autoBackup().catch(() => { })
})

app.on('window-all-closed', () => app.quit())
