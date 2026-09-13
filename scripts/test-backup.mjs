// Testet Backup/Restore direkt (ohne Electron-UI): Erstellt ein Backup der
// echten Daten und stellt es risikofrei auf sich selbst wieder her.
import backup from '../electron/backup.cjs'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const tmp = path.join(os.tmpdir(), 'kickrstudio-test-backup.zip')

const r1 = await backup.createBackupZip(tmp)
console.log('createBackupZip ->', JSON.stringify(r1))

const listScript = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [System.IO.Compression.ZipFile]::OpenRead('${tmp.replace(/'/g, "''")}'); $z.Entries | ForEach-Object { $_.FullName } | Sort-Object; $z.Dispose()`
const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-Command', listScript])
console.log('ZIP-Inhalt:\n' + stdout)

console.log('Stelle Backup auf sich selbst wieder her (Idempotenz-Test)...')
const before = fs.readFileSync(path.join(process.env.APPDATA, 'kickr-studio', 'settings.json'), 'utf8')
const r2 = await backup.restoreBackupZip(tmp)
console.log('restoreBackupZip ->', JSON.stringify(r2))
const after = fs.readFileSync(path.join(process.env.APPDATA, 'kickr-studio', 'settings.json'), 'utf8')
console.log('settings.json unveraendert:', before === after)

fs.unlinkSync(tmp)
console.log('OK')
