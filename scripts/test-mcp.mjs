// Smoke-Test für den MCP-Server: initialize → tools/list → get_profile → create_workout → queue_workout → get_training_load
import { spawn } from 'node:child_process'

const proc = spawn(process.execPath, ['mcp/server.mjs'], { stdio: ['pipe', 'pipe', 'inherit'] })
let buf = ''
const pending = new Map()
let nextId = 1

proc.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})

function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
console.log('initialize →', init.result?.serverInfo)
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

const tools = await rpc('tools/list', {})
console.log('tools →', tools.result?.tools?.map(t => t.name).join(', '))

const profile = await rpc('tools/call', { name: 'get_profile', arguments: {} })
console.log('get_profile →', profile.result?.content?.[0]?.text?.slice(0, 120).replace(/\n/g, ' '))

const created = await rpc('tools/call', {
  name: 'create_workout',
  arguments: {
    name: 'Test Pyramide',
    description: 'MCP-Testworkout',
    tags: ['Test'],
    segments: [
      { type: 'warmup', sec: 300, fromPct: 40, toPct: 70 },
      { type: 'intervals', reps: 3, onSec: 120, onPct: 105, offSec: 120, offPct: 50 },
      { type: 'cooldown', sec: 300, fromPct: 60, toPct: 40 },
    ],
  },
})
console.log('create_workout →', created.result?.content?.[0]?.text?.replace(/\n/g, ' '))

const queued = await rpc('tools/call', { name: 'queue_workout', arguments: { workout_id: JSON.parse(created.result.content[0].text).id, note: 'Testempfehlung von Claude' } })
console.log('queue_workout →', queued.result?.content?.[0]?.text?.replace(/\n/g, ' '))

const load = await rpc('tools/call', { name: 'get_training_load', arguments: { weeks: 4 } })
console.log('get_training_load →', load.result?.content?.[0]?.text?.slice(0, 200).replace(/\n/g, ' '))

const invalid = await rpc('tools/call', { name: 'create_workout', arguments: { name: 'Kaputt', segments: [{ type: 'steady', sec: -5 }] } })
console.log('create_workout (invalid) →', invalid.error ? 'korrekt abgelehnt' : JSON.stringify(invalid.result).slice(0, 120))

proc.kill()
process.exit(0)
