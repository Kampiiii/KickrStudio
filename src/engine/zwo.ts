// Import von .zwo-Dateien (XML-Workouts, wie sie viele Trainingsplattformen und Community-Seiten anbieten).
// Leistungswerte in ZWO sind Anteile der FTP (0,75 = 75 %) und passen damit direkt auf unser %FTP-Modell.
import type { Segment, Workout } from './model'

export interface ZwoResult {
  workout: Workout
  skipped: number // nicht unterstützte Elemente (z.B. Textmeldungen werden still ignoriert, unbekannte Blöcke gezählt)
}

const num = (el: Element, attr: string, fallback = 0): number => {
  const v = Number(el.getAttribute(attr))
  return Number.isFinite(v) && el.hasAttribute(attr) ? v : fallback
}
// 0,75 -> 75; Werte über 3 gelten schon als Prozent
const pct = (v: number) => Math.round((v > 3 ? v : v * 100) * 10) / 10

export function parseZwo(xml: string, fileName = 'Workout'): ZwoResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Die Datei ist kein gültiges XML.')
  const root = doc.documentElement
  const body = root.querySelector('workout')
  if (!body) throw new Error('Kein <workout>-Block gefunden — ist das eine .zwo-Datei?')

  const text = (tag: string) => root.querySelector(tag)?.textContent?.trim() || ''
  const segments: Segment[] = []
  let skipped = 0

  for (const el of Array.from(body.children)) {
    const sec = Math.max(1, Math.round(num(el, 'Duration', 0)))
    switch (el.tagName) {
      case 'Warmup':
        segments.push({ type: 'warmup', sec, fromPct: pct(num(el, 'PowerLow', 0.5)), toPct: pct(num(el, 'PowerHigh', 0.75)) })
        break
      case 'Cooldown':
        segments.push({ type: 'cooldown', sec, fromPct: pct(num(el, 'PowerLow', 0.75)), toPct: pct(num(el, 'PowerHigh', 0.5)) })
        break
      case 'Ramp':
        segments.push({ type: 'ramp', sec, fromPct: pct(num(el, 'PowerLow', 0.5)), toPct: pct(num(el, 'PowerHigh', 0.8)) })
        break
      case 'SteadyState':
        segments.push({ type: 'steady', sec, pct: pct(num(el, 'Power', num(el, 'PowerLow', 0.7))) })
        break
      case 'IntervalsT':
        segments.push({
          type: 'intervals', reps: Math.max(1, Math.round(num(el, 'Repeat', 1))),
          onSec: Math.max(1, Math.round(num(el, 'OnDuration', 60))), onPct: pct(num(el, 'OnPower', 1)),
          offSec: Math.max(1, Math.round(num(el, 'OffDuration', 60))), offPct: pct(num(el, 'OffPower', 0.5)),
        })
        break
      case 'FreeRide':
        segments.push({ type: 'freeride', sec })
        break
      default:
        skipped++
    }
  }
  if (segments.length === 0) throw new Error('Das Workout enthält keine unterstützten Abschnitte.')

  const tags = Array.from(root.querySelectorAll('tags > tag')).map(t => t.getAttribute('name') || '').filter(Boolean)
  const name = text('name') || fileName.replace(/\.zwo$/i, '')
  const author = text('author')
  const description = [text('description'), author ? `Autor: ${author}` : ''].filter(Boolean).join(' — ')
  const slug = name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'zwo'

  return {
    workout: {
      id: `zwo-${slug}-${Date.now().toString(36)}`,
      name, description, tags: ['Import', ...tags.slice(0, 3)], source: 'custom', segments,
    },
    skipped,
  }
}
