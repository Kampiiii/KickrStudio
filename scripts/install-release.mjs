// Installiert das zuvor mit package-app.mjs gebaute Release nach
// %LOCALAPPDATA%\Programs\KickrStudio und legt/aktualisiert die
// Desktop-Verknüpfung an (Icon zeigt auf die installierte Kopie,
// bleibt also auch bestehen wenn der Projekt-/Quellordner verschoben wird).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const buildRoot = process.env.KICKR_BUILD_DIR || path.join(os.tmpdir(), 'kickrstudio-build')
const builtDir = path.join(buildRoot, 'win-unpacked')
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'KickrStudio')

if (!fs.existsSync(path.join(builtDir, 'KickrStudio.exe'))) {
  console.error('Kein Build gefunden — zuerst `npm run build:app` ausführen.')
  process.exit(1)
}

console.log('Installiere nach', installDir, '...')
fs.rmSync(installDir, { recursive: true, force: true })
fs.cpSync(builtDir, installDir, { recursive: true })

const ps = `
$desktop = [Environment]::GetFolderPath('Desktop')
$WshShell = New-Object -ComObject WScript.Shell
$shortcut = $WshShell.CreateShortcut("$desktop\\KickrStudio.lnk")
$shortcut.TargetPath = '${installDir}\\KickrStudio.exe'
$shortcut.WorkingDirectory = '${installDir}'
$shortcut.IconLocation = '${installDir}\\resources\\app\\build\\icon.ico'
$shortcut.Description = 'KickrStudio - Wahoo Kickr Trainingsapp'
$shortcut.Save()
Write-Output "$desktop\\KickrStudio.lnk"
`
const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
console.log('Desktop-Verknüpfung:', stdout.trim())
console.log('Fertig. KickrStudio.exe liegt unter', path.join(installDir, 'KickrStudio.exe'))
