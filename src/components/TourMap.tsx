// Karte einer Tour: ganze Strecke blass, bereits gefahrener Teil kräftig, aktueller Punkt als Marker.
// Ohne distM ist es eine reine Vorschau der Strecke. OSM-Kacheln wie in RouteMap (nur sichtbarer Ausschnitt).
import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Tour } from '../engine/tour'

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const MAX_POINTS = 1500

export default function TourMap({ tour, distM, follow = false, height = 320 }: { tour: Tour; distM?: number; follow?: boolean; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef<{ map: L.Map; done: L.Polyline; dot: L.CircleMarker; coords: [number, number][]; stride: number } | null>(null)

  // Karte einmal pro Tour aufbauen
  useEffect(() => {
    if (!ref.current) return
    const stride = Math.max(1, Math.ceil(tour.lat.length / MAX_POINTS))
    const coords: [number, number][] = []
    for (let i = 0; i < tour.lat.length; i += stride) coords.push([tour.lat[i], tour.lng[i]])
    coords.push([tour.lat[tour.lat.length - 1], tour.lng[tour.lng.length - 1]])

    const map = L.map(ref.current, { zoomControl: true, attributionControl: true })
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>-Mitwirkende',
    }).addTo(map)
    const full = L.polyline(coords, { color: '#8b98a9', weight: 4, opacity: 0.6 }).addTo(map)
    const done = L.polyline([], { color: '#e5484d', weight: 5, opacity: 0.95 }).addTo(map)
    L.circleMarker(coords[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#3ecf8e', fillOpacity: 1 }).addTo(map).bindTooltip('Start')
    L.circleMarker(coords[coords.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#8b98a9', fillOpacity: 1 }).addTo(map).bindTooltip('Ziel')
    const dot = L.circleMarker(coords[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#3ecf8e', fillOpacity: 1 })
    if (distM != null) dot.addTo(map)
    map.fitBounds(full.getBounds(), { padding: [24, 24] })
    live.current = { map, done, dot, coords, stride }
    return () => { map.remove(); live.current = null }
  }, [tour])

  // Position und gefahrene Linie nachführen
  useEffect(() => {
    const l = live.current
    if (!l || distM == null) return
    const idx = Math.min(tour.lat.length - 1, Math.floor(distM / tour.stepM))
    const upTo = Math.floor(idx / l.stride)
    const here: [number, number] = [
      tour.lat[idx] + ((tour.lat[Math.min(idx + 1, tour.lat.length - 1)] - tour.lat[idx]) * ((distM / tour.stepM) - idx)),
      tour.lng[idx] + ((tour.lng[Math.min(idx + 1, tour.lng.length - 1)] - tour.lng[idx]) * ((distM / tour.stepM) - idx)),
    ]
    l.done.setLatLngs([...l.coords.slice(0, upTo + 1), here])
    l.dot.setLatLng(here)
    if (follow) l.map.panTo(here, { animate: true, duration: 0.8 })
  }, [distM, follow, tour])

  // Beim Wechsel zurück auf "Übersicht" wieder die ganze Strecke zeigen
  useEffect(() => {
    const l = live.current
    if (l && !follow) l.map.fitBounds(L.polyline(l.coords).getBounds(), { padding: [24, 24] })
    if (l && follow && distM != null) l.map.setZoom(Math.max(l.map.getZoom(), 15))
  }, [follow])

  return <div ref={ref} style={{ width: '100%', height, borderRadius: 10, overflow: 'hidden' }} />
}
