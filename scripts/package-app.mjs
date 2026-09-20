// Manuelles Packaging als Fallback für electron-builder's Download/Entpack-Schritt,
// der in dieser Umgebung an einem EPERM-Rename beim Umbenennen des frisch
// heruntergeladenen Electron-Verzeichnisses scheitert (vermutlich Virenschutz-Sperre
// auf der frisch entpackten electron.exe). Wir verwenden stattdessen die bereits
// lokal installierte Electron-Distribution aus node_modules/electron/dist.
//
// electron/main.cjs, preload.cjs & Co. nutzen ausschließlich eingebaute Node-Module
// (fs, path, http, os, child_process) plus die von Electron selbst bereitgestellte
// "electron"-API — kein npm-Paket aus node_modules wird zur Laufzeit benötigt.
// Daher genügt ein reines Kopieren, kein Bundling.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execSync } from 'node:child_process'

const root = process.cwd()
// Im TEMP-Verzeichnis bauen: unter dem Projektordner (evtl. von Virenschutz/Indexer
// beobachtet) blieben Datei-Locks auf frisch entpackten Electron-Binärdateien hängen.
const buildRoot = process.env.KICKR_BUILD_DIR || path.join(os.tmpdir(), 'kickrstudio-build')
const outDir = path.join(buildRoot, 'win-unpacked')
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')

if (!fs.existsSync(electronDist)) {
  console.error('node_modules/electron/dist nicht gefunden — npm install ausführen.')
  process.exit(1)
}

fs.rmSync(buildRoot, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

console.log('Kopiere Electron-Runtime...')
fs.cpSync(electronDist, outDir, { recursive: true })
fs.renameSync(path.join(outDir, 'electron.exe'), path.join(outDir, 'KickrStudio.exe'))

const appDir = path.join(outDir, 'resources', 'app')
fs.mkdirSync(appDir, { recursive: true })

console.log('Kopiere App-Code...')
fs.cpSync(path.join(root, 'electron'), path.join(appDir, 'electron'), { recursive: true })
fs.cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true })
fs.mkdirSync(path.join(appDir, 'build'), { recursive: true })
fs.copyFileSync(path.join(root, 'build', 'icon.ico'), path.join(appDir, 'build', 'icon.ico'))

// Laufzeit-Abhängigkeiten des Main-Prozesses (React & Co. sind per Vite ins Frontend gebündelt,
// mcp/ läuft separat aus dem Projektordner). Aktuell nur die Google-Cloud-Clients.
const RUNTIME_DEPS = ['@google-cloud/bigquery', '@google-cloud/storage']

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const dependencies = Object.fromEntries(RUNTIME_DEPS.map(name => [name, rootPkg.dependencies[name]]))
fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
  name: rootPkg.name,
  productName: rootPkg.productName,
  version: rootPkg.version,
  main: 'electron/main.cjs',
  dependencies,
}, null, 2))

console.log('Installiere Laufzeit-Abhängigkeiten (Google Cloud)...')
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: appDir, stdio: 'inherit' })

console.log('Fertig:', path.join(outDir, 'KickrStudio.exe'))
