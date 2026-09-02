'use client'

import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { MapProperty } from './PropertyMap'

// CRITICAL — the worker must be a real same-origin file, never bundler-reconstructed.
// maplibre's default builds cannot survive Turbopack (v5 stringifies its own module
// functions to rebuild the worker; v6 relies on import.meta.url asset emission — both
// break SILENTLY: style/sprites/markers load, zero tile requests, blank beige map).
// scripts/copy-maplibre-worker.mjs (predev/prebuild) keeps this file in sync with the
// installed maplibre version; CSP-wise it's plain 'self'. Module scope: must run
// before the first Map is constructed.
maplibregl.setWorkerUrl('/maplibre-gl-csp-worker.js')

// ---------------------------------------------------------------------------
// The actual MapLibre-touching component (Track M). Replaces the original Leaflet
// build: raster OSM tiles under a grayscale filter looked muddy at every zoom, and
// raster zooming snaps between levels. This renders OpenFreeMap's vector tiles
// instead — crisp text and hairline roads at any zoom/DPI, smooth continuous
// zooming, and the "positron" style is already a calm light-gray, so the filter
// hack is gone entirely. OpenFreeMap is keyless, unlimited, and OSM-attributed
// (the style JSON carries its own attribution, surfaced by the compact control).
//
// Only ever reached via PropertyMap.tsx's `next/dynamic(..., { ssr: false })`
// import — maplibre-gl needs a real DOM/WebGL context, and the ssr:false split
// keeps its chunk out of the shared client bundle (the M2 acceptance check).
//
// React-Compiler-safe by construction: all map object creation/mutation happens
// inside the effect below, scoped to a ref'd container, and the cleanup calls
// map.remove() — no map instance is ever held in render or component state.
// ---------------------------------------------------------------------------

// Swap to https://tiles.openfreemap.org/styles/dark if the app ever grows a real
// dark mode (today .dark is defined in globals.css but never applied).
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const MAX_ZOOM = 19
const SINGLE_PIN_ZOOM = 15.5
// Fallback view when there are zero pins to fit (unreachable in practice — the page
// only mounts this with at least one located property — but the map still needs SOME
// initial view). Roughly Vienna, matching the seed data. MapLibre is [lng, lat].
const FALLBACK_CENTER: [number, number] = [16.3738, 48.2082]
const FALLBACK_ZOOM = 4
const FIT_PADDING = 56
const FIT_MAX_ZOOM = 16

// Graphite pin — lucide's plain "MapPin" glyph (teardrop tapering to a point), inlined
// as raw SVG since markers render plain DOM, not React. fill-foreground/text-background
// keep it legible on the light basemap and match the rest of the app's iconography.
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-8 fill-foreground text-background drop-shadow">' +
  '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />' +
  '<circle cx="12" cy="10" r="3" />' +
  '</svg>'

// The marker root's transform is OWNED by MapLibre (it positions markers via
// translate), so the hover scale lives on an inner wrapper — never on the element
// MapLibre manages. innerHTML is fine here: PIN_SVG is a static trusted constant.
function createPinElement(property: MapProperty): HTMLElement {
  const el = document.createElement('div')
  el.className = 'group cursor-pointer'
  el.setAttribute('role', 'button')
  el.setAttribute('tabindex', '0')
  el.setAttribute('aria-label', property.name)
  el.title = property.name

  const inner = document.createElement('div')
  inner.className =
    'origin-bottom transition-transform duration-[--duration-fast] ease-[--ease-out] group-hover:scale-110 group-focus-visible:scale-110'
  inner.innerHTML = PIN_SVG
  el.appendChild(inner)
  return el
}

// Popup content built via plain DOM calls (createElement/textContent), never innerHTML
// for data — property name/address are workspace data, not attacker input, but this
// sidesteps any HTML-escaping question entirely (the app's no-dangerouslySetInnerHTML
// posture). A real <a href> (not a Next <Link>) is deliberate: MapLibre popups live
// outside the React tree, so a plain anchor + full navigation is correct here.
function buildPopupContent(property: MapProperty): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'flex flex-col gap-1 text-sm'

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

export default function VectorMap({ properties }: { properties: MapProperty[] }) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Initial view resolved BEFORE construction (constructor `bounds` beats a
    // post-init fitBounds — no visible jump on load): one pin centers on it,
    // several fit their bounds, zero falls back.
    const single = properties.length === 1
    let bounds: maplibregl.LngLatBounds | undefined
    if (properties.length > 1) {
      bounds = new maplibregl.LngLatBounds()
      for (const p of properties) bounds.extend([p.longitude, p.latitude])
    }

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: single
        ? [properties[0].longitude, properties[0].latitude]
        : FALLBACK_CENTER,
      zoom: single ? SINGLE_PIN_ZOOM : FALLBACK_ZOOM,
      ...(bounds ? { bounds, fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM } } : {}),
      maxZoom: MAX_ZOOM,
      // Flat, calm map: no rotate/pitch gestures — a portfolio map has no use for
      // 3D camera work, and accidental rotation is pure confusion.
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
    })
    map.touchZoomRotate.disableRotation()
    map.keyboard.disableRotation()

    // Compact ⓘ attribution (style JSON supplies the OSM/OpenFreeMap credit) and
    // plain +/− zoom — no compass, nothing else.
    map.addControl(new maplibregl.AttributionControl({ compact: true }))
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

    for (const property of properties) {
      const el = createPinElement(property)
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([property.longitude, property.latitude])
        .setPopup(
          new maplibregl.Popup({ offset: 30, closeButton: false, maxWidth: '280px' }).setDOMContent(
            buildPopupContent(property)
          )
        )
        .addTo(map)
      // MapLibre toggles the popup on click; mirror it for keyboard users (the pin
      // element is focusable via tabindex above).
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          marker.togglePopup()
        }
      })
    }

    return () => {
      map.remove()
    }
  }, [properties])

  return <div ref={containerRef} className="h-full w-full" />
}
