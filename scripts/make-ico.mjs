// Baut ein Windows-Multiauflösungs-Icon (build/icon.ico) aus den gerenderten PNGs.
import pngToIco from 'png-to-ico'
import fs from 'node:fs'

const sizes = [16, 32, 64, 128, 256, 512]
const buf = await pngToIco(sizes.map(s => `assets/icon-${s}.png`))
fs.mkdirSync('build', { recursive: true })
fs.writeFileSync('build/icon.ico', buf)
console.log('build/icon.ico', buf.length, 'Bytes')
