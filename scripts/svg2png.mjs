// Rendert assets/icon.svg über den Electron-Renderer (CDP) zu PNGs.
import fs from 'node:fs'

const port = process.env.CDP_PORT || '9223'
const svg = fs.readFileSync('assets/icon.svg', 'utf8')
const svgB64 = Buffer.from(svg).toString('base64')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.error('Kein Page-Target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

function evaluate(expression) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve) => {
    const h = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', h); resolve(m) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
}

const sizes = process.argv[2] ? process.argv.slice(2).map(Number) : [512, 128]
for (const size of sizes) {
  const expr = `(async () => {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,${svgB64}'
    await img.decode()
    const c = document.createElement('canvas')
    c.width = ${size}; c.height = ${size}
    c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size})
    return c.toDataURL('image/png').split(',')[1]
  })()`
  const r = await evaluate(expr)
  if (r.result?.exceptionDetails) { console.error(JSON.stringify(r.result.exceptionDetails)); process.exit(1) }
  const out = `assets/icon-${size}.png`
  fs.writeFileSync(out, Buffer.from(r.result.result.value, 'base64'))
  console.log(out, fs.statSync(out).size, 'Bytes')
}
ws.close()
process.exit(0)
