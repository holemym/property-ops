'use client'

import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { MapProperty } from './PropertyMap'

// ---------------------------------------------------------------------------
// The actual Leaflet-touching component (Track M). Only ever reached via
// PropertyMap.tsx's `next/dynamic(..., { ssr: false })` import — never imported
// statically anywhere, so `leaflet` (which reads `window` at import time) never loads
// during SSR and never lands in the shared client bundle (see the M2 build-output
// acceptance check: Leaflet must stay out of the shared chunk).
//
// React-Compiler-safe by construction: all Leaflet object creation/mutation happens
// inside the effect below, scoped to a ref'd container, and the cleanup calls
// map.remove() — no Leaflet instance is ever held in render or component state.
// ---------------------------------------------------------------------------

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
const TILE_MAX_ZOOM = 19
const SINGLE_PIN_ZOOM = 16
// Fallback view when there are zero pins to fit (unreachable in practice — the page only
// ever mounts this component with at least one located property — but a Leaflet map
// still needs SOME initial view). Centered roughly on Vienna, matching the seed data.
const FALLBACK_CENTER: L.LatLngExpression = [48.2082, 16.3738]
const FALLBACK_ZOOM = 4
const FIT_BOUNDS_PADDING: L.PointTuple = [32, 32]

// Graphite pin — lucide's plain "MapPin" glyph (teardrop tapering to a point), inlined as
// raw SVG since Leaflet renders plain DOM, not React. fill-foreground/text-background
// mirror the preview mock's pin styling and stay legible in dark mode (both tokens flip
// with the theme). A dedicated icon (not react-driven) is required here — bindPopup/
// divIcon content is DOM, not JSX.
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-8 fill-foreground text-background drop-shadow">' +
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />' +
  '<circle cx="12" cy="10" r="3" />' +
  '</svg>'

function createPinIcon(): L.DivIcon {
  return L.divIcon({
    html: PIN_SVG,
    // Empty className drops Leaflet's default 'leaflet-div-icon' class (a white box with
    // a border) — the SVG above is the entire visual, no default chrome to reset.
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32], // bottom-center — the pin's point, not its bounding-box center.
    popupAnchor: [0, -30],
  })
}

// Popup content built via plain DOM calls (createElement/textContent), never innerHTML —
// property name/address are workspace data, not attacker input, but this sidesteps any
// HTML-escaping question entirely (matches the app's no-dangerouslySetInnerHTML posture).
// A real <a href> (not a Next <Link>) is deliberate: Leaflet popups live outside the React
// tree, so a plain anchor + full navigation is the correct, standard approach for
// vanilla-Leaflet (non-react-leaflet) popups.
function buildPopupContent(property: MapProperty): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'flex flex-col gap-1 py-0.5 pr-2 text-sm'

  const link = document.createElement('a')
  link.href = `/properties/${property.id}`
  link.className = 'font-medium text-foreground hover:underline'
  link.textContent = property.name
  wrap.appendChild(link)

  const address = document.createElement('p')
  address.className = 'text-xs text-muted-foreground'
  address.textContent = property.address
  wrap.appendChild(address)

  const meta = document.createElement('p')
  meta.className = 'text-xs text-muted-foreground'
  const unitLabel = property.unitCount === 1 ? 'unit' : 'units'
  const ticketLabel = property.openTicketCount === 1 ? 'ticket' : 'tickets'
  meta.textContent = `${property.unitCount} ${unitLabel} · ${property.openTicketCount} open ${ticketLabel}`
  wrap.appendChild(meta)

  return wrap
}

export default function LeafletMap({ properties }: { properties: MapProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = L.map(container, {
      center: FALLBACK_CENTER,
      zoom: FALLBACK_ZOOM,
      scrollWheelZoom: true,
    })

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: TILE_MAX_ZOOM,
    }).addTo(map)

    const icon = createPinIcon()
    for (const property of properties) {
      L.marker([property.latitude, property.longitude], {
        icon,
        // Accessible name: Leaflet markers are keyboard-focusable; without these the
        // divIcon pins are announced as nothing.
        title: property.name,
        alt: property.name,
      })
        .addTo(map)
        .bindPopup(buildPopupContent(property))
    }

    if (properties.length === 1) {
      map.setView([properties[0].latitude, properties[0].longitude], SINGLE_PIN_ZOOM)
    } else if (properties.length > 1) {
      const bounds = L.latLngBounds(properties.map((p): L.LatLngTuple => [p.latitude, p.longitude]))
      map.fitBounds(bounds, { padding: FIT_BOUNDS_PADDING })
    }

    return () => {
      map.remove()
    }
  }, [properties])

  return <div ref={containerRef} className="h-full w-full" />
}
