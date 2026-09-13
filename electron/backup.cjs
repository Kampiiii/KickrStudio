// Backup/Restore der KickrStudio-Daten (Settings, Workouts, Verlauf, Körperdaten, Plan)
// als ZIP, per PowerShell Compress-Archive/Expand-Archive — keine zusätzliche
// npm-Abhängigkeit nötig, funktioniert nativ auf Windows.
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const store = require('./store.cjs')

// Auto-Backups liegen bewusst NEBEN dem Datenordner (nicht darin!), sonst würde
// jedes Backup alle vorherigen Backups mit einzippen (rekursives Wachstum).
const BACKUP_DIR = path.join(path.dirname(store.DATA_DIR), 'kickr-studio-backups')
const AUTO_KEEP = 10

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 32 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message))
        else resolve(stdout)
      })
  })
}

async function createBackupZip(destPath) {
  store.ensureDirs()
  if (fs.existsSync(destPath)) fs.unlinkSync(destPath)
  const script = `Compress-Archive -Path ${psQuote(path.join(store.DATA_DIR, '*'))} -DestinationPath ${psQuote(destPath)} -Force -CompressionLevel Optimal`
  await runPowerShell(script)
  return { path: destPath, size: fs.statSync(destPath).size }
}

async function restoreBackupZip(zipPath) {
  if (!fs.existsSync(zipPath)) throw new Error('Backup-Datei nicht gefunden: ' + zipPath)
  store.ensureDirs()
  const script = `Expand-Archive -Path ${psQuote(zipPath)} -DestinationPath ${psQuote(store.DATA_DIR)} -Force`
  await runPowerShell(script)
  return { ok: true }
}

async function autoBackup() {
  // Beim ersten Start (noch keine Einstellungen) gibt es nichts zu sichern.
  if (!fs.existsSync(path.join(store.DATA_DIR, 'settings.json'))) return
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(BACKUP_DIR, `auto-${stamp}.zip`)
  await createBackupZip(dest)

  // Nur die letzten AUTO_KEEP automatischen Backups behalten
  const autos = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('auto-') && f.endsWith('.zip'))
    .sort()
  for (const old of autos.slice(0, Math.max(0, autos.length - AUTO_KEEP))) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)) } catch { }
  }
  return dest
}

function listAutoBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.zip'))
    .map(f => {
      const full = path.join(BACKUP_DIR, f)
      const st = fs.statSync(full)
      return { name: f, path: full, sizeBytes: st.size, mtime: st.mtime.toISOString() }
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
}

module.exports = { createBackupZip, restoreBackupZip, autoBackup, listAutoBackups, BACKUP_DIR }
