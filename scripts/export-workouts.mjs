// Exportiert die eingebaute Programm-Bibliothek (src/engine/library.ts) als JSON für die Cloud-Jobs
// (cloud/guard), damit Wächter und App denselben Katalog verwenden.
//   node scripts/export-workouts.mjs
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = path.join(root, 'scripts', '.library.tmp.cjs')

await build({ entryPoints: [path.join(root, 'src/engine/library.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmp, logLevel: 'error' })
const { BUILTIN_WORKOUTS } = createRequire(import.meta.url)(tmp)
rmSync(tmp)

const out = path.join(root, 'cloud', 'guard', 'workouts.json')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(BUILTIN_WORKOUTS, null, 1))
console.log(`${BUILTIN_WORKOUTS.length} Workouts nach ${path.relative(root, out)} exportiert.`)
