const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kickr', {
  // Bluetooth-Auswahl (Chooser-Liste kommt aus dem Main-Prozess)
  onBleDevices: (cb) => {
    const listener = (_e, devices) => cb(devices)
    ipcRenderer.on('ble:devices', listener)
    return () => ipcRenderer.removeListener('ble:devices', listener)
  },
  bleSelect: (deviceId) => ipcRenderer.send('ble:select', deviceId),
  bleCancel: () => ipcRenderer.send('ble:cancel'),

  // Daten
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  listWorkouts: () => ipcRenderer.invoke('workouts:list'),
  saveWorkout: (w) => ipcRenderer.invoke('workouts:save', w),
  deleteWorkout: (id) => ipcRenderer.invoke('workouts:delete', id),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getSession: (id) => ipcRenderer.invoke('sessions:get', id),
  saveSession: (s) => ipcRenderer.invoke('sessions:save', s),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  notifyPlayerStatus: (status) => ipcRenderer.send('player:status', status),
  getDraftSession: () => ipcRenderer.invoke('draft:get'),
  saveDraftSession: (draft) => ipcRenderer.invoke('draft:save', draft),
  clearDraftSession: () => ipcRenderer.invoke('draft:clear'),

  getQueuedWorkout: () => ipcRenderer.invoke('queue:get'),
  snapshotBuiltins: (list) => ipcRenderer.invoke('builtins:snapshot', list),
  clearQueuedWorkout: () => ipcRenderer.invoke('queue:clear'),
  onDataChanged: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('data:changed', listener)
    return () => ipcRenderer.removeListener('data:changed', listener)
  },

  // Export/Strava
  exportTcx: (sessionId) => ipcRenderer.invoke('export:tcx', sessionId),
  withingsConnect: () => ipcRenderer.invoke('withings:connect'),
  withingsDisconnect: () => ipcRenderer.invoke('withings:disconnect'),
  withingsSync: () => ipcRenderer.invoke('withings:sync'),
  listBody: () => ipcRenderer.invoke('body:list'),
  listPlan: () => ipcRenderer.invoke('plan:list'),
  savePlanEntry: (entry) => ipcRenderer.invoke('plan:save', entry),
  deletePlanEntry: (id) => ipcRenderer.invoke('plan:delete', id),
  stravaConnect: () => ipcRenderer.invoke('strava:connect'),
  stravaDisconnect: () => ipcRenderer.invoke('strava:disconnect'),
  stravaUpload: (sessionId) => ipcRenderer.invoke('strava:upload', sessionId),

  // App
  appInfo: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  openDataDir: () => ipcRenderer.invoke('app:openDataDir'),
  keepAwake: (on) => ipcRenderer.invoke('power:keepAwake', on),

  backupCreate: () => ipcRenderer.invoke('backup:create'),
  backupRestore: () => ipcRenderer.invoke('backup:restore'),
  listAutoBackups: () => ipcRenderer.invoke('backup:listAuto'),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder'),
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),

  cloudTest: () => ipcRenderer.invoke('cloud:test'),
  cloudSync: () => ipcRenderer.invoke('cloud:sync'),
  cloudAsk: (question, sessionId) => ipcRenderer.invoke('cloud:ask', question, sessionId),

  getDebugLog: () => ipcRenderer.invoke('debug:getLog'),
  openLogFolder: () => ipcRenderer.invoke('debug:openLogFolder'),
})
