// Mini-CDP-Client (nutzt Nodes eingebauten WebSocket): führt JS im
// Electron-Renderer aus. Aufruf: node scripts/cdp.mjs "<expression>"
const port = process.env.CDP_PORT || '9223'
const expr = process.argv[2] || 'document.title'

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(t => t.type === 'page' && !t.url.startsWith('devtools'))
if (!page) { console.error('Kein Page-Target gefunden:', list.map(t => `${t.type}:${t.url}`)); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

function send(method, params) {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id === id) { ws.removeEventListener('message', handler); resolve(msg) }
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
if (r.result?.exceptionDetails) console.error('EXCEPTION:', JSON.stringify(r.result.exceptionDetails, null, 2))
else console.log(JSON.stringify(r.result?.result?.value, null, 2))
ws.close()
process.exit(0)
