// Karte der Strecke einer Einheit (GPS aus den Strava-Sekundenwerten) mit Leaflet + OpenStreetMap-Kacheln.
// Kacheln werden nur für den sichtbaren Ausschnitt geladen (normale Nutzung laut OSM-Richtlinie),
// kein Offline-Download. Die Kachel-URL ist bewusst eine Konstante, damit sie sich leicht ersetzen lässt.
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const MAX_POINTS = 1200

type GpsSample = { lat?: number; lng?: number }

export function hasGps(samples: GpsSample[] | undefined): boolean {
  return !!samples && samples.filter(s => s.lat != null && s.lng != null).length > 1
}

export default function RouteMap({ samples, height = 360 }: { samples: GpsSample[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const all = samples.filter(s => s.lat != null && s.lng != null) as { lat: number; lng: number }[]
    if (all.length < 2) return
    // Lange Strecken ausdünnen: ~1200 Punkte reichen für eine glatte Linie und halten die Karte flüssig
    const step = Math.max(1, Math.ceil(all.length / MAX_POINTS))
    const pts = all.filter((_, i) => i % step === 0 || i === all.length - 1).map(s => [s.lat, s.lng] as [number, number])

    const map = L.map(ref.current, { zoomControl: true, attributionControl: true })
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map)

    const line = L.polyline(pts, { color: '#e5484d', weight: 4, opacity: 0.9 }).addTo(map)
    // circleMarker statt Standard-Marker: braucht keine Bilddateien (die würden im Paket fehlen)
    L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: '#3ecf8e', fillOpacity: 1 }).addTo(map).bindTooltip('Start')
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#e5484d', fillOpacity: 1 }).addTo(map).bindTooltip('Ziel')
    map.fitBounds(line.getBounds(), { padding: [24, 24] })

    return () => { map.remove() }
  }, [samples])

  return <div ref={ref} style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden' }} />
}
