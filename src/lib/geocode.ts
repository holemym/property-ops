// ---------------------------------------------------------------------------
// Geocoding — Nominatim (OpenStreetMap), the map view's address -> coordinates
// transport (Track M).
//
// Same "disconnected-safe" family as src/lib/email/send.ts and src/lib/ai/triage.ts:
// geocodeAddress() NEVER throws. Nominatim needs no API key (it's OSM's free public
// search endpoint), so unlike email/AI triage there is no "disabled" state to gate on —
// every call attempts a real request — but any failure (empty address, network error,
// timeout, non-2xx, unparseable/empty response) resolves to `null` rather than
// rejecting, so a geocoding hiccup can never fail the property save that triggered it.
// See src/lib/geocode-service.ts for the write side that persists the result.
//
// Nominatim usage policy (https://operations.osmfoundation.org/policies/nominatim/):
// a descriptive User-Agent is REQUIRED, and callers must serialize to max 1
// request/second. This module issues one request per call and never loops itself —
// the manager-only backfill action (src/app/(app)/map/actions.ts) is the one caller
// that issues several, and it is responsible for spacing them out.
// ---------------------------------------------------------------------------

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search'
const DEFAULT_CONTACT = 'contact@property-ops.example'
const REQUEST_TIMEOUT_MS = 5000

export type AddressParts = {
  line1: string
  postalCode: string
  city: string
  country: string
}

export type GeocodeResult = { lat: number; lng: number }

// Workspace-scoped rate-limit budget for outbound geocode calls (enforced by callers
// via src/lib/rate-limit.ts's checkRateLimit — this module intentionally does not
// rate-limit itself, see the header above). One Nominatim identity/IP serves every
// workspace on this shared multi-tenant deployment, so every entry point that can
// trigger a geocodeAddress() call — property create/update
// (src/app/(app)/properties/actions.ts) and the backfill loop
// (src/app/(app)/map/actions.ts) — MUST check this SAME key before calling it. Keyed
// per workspace so one workspace's usage can never exhaust another's budget; capped
// so no single workspace can blow the shared identity's real-world Nominatim budget
// (and risk a ban that would silently break geocoding for every workspace on the
// deployment). One save = one call; the backfill loop already paces itself at
// 1.1s/property capped at 20 — 30/60s comfortably covers normal usage while stopping
// a runaway loop (double-click, script, or a buggy retry).
export const GEOCODE_RATE_LIMIT_MAX = 30
export const GEOCODE_RATE_LIMIT_WINDOW_SECONDS = 60

/** The one shared bucket key every geocode call site must use — see the constants above. */
export function geocodeRateLimitKey(workspaceId: string): string {
  return `geocode:${workspaceId}`
}

/**
 * Pure formatter: "line1, postalCode city, country" — trims each part and drops any
 * that are blank, so a missing postal code (or any other part) doesn't leave a stray
 * double space or a leading/trailing comma. All parts blank returns ''. Unit-tested
 * directly — see tests/unit/geocode.test.ts.
 */
export function buildGeocodeQuery(parts: AddressParts): string {
  const line1 = (parts.line1 ?? '').trim()
  const postalCode = (parts.postalCode ?? '').trim()
  const city = (parts.city ?? '').trim()
  const country = (parts.country ?? '').trim()

  // "postalCode city" collapses to whichever half is present; dropped entirely if
  // both are blank (rather than leaving a lone leading space in the joined query).
  const cityLine = [postalCode, city].filter(Boolean).join(' ')

  return [line1, cityLine, country].filter(Boolean).join(', ')
}

// Number('') and Number('   ') both evaluate to 0 (JS's ToNumber on a blank/whitespace
// string), NOT NaN — so a blank lat/lon string must be rejected explicitly before
// coercion, or it would silently "parse" as a bogus (0, 0) coordinate.
function toFiniteNumber(value: string | number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Pure parser for Nominatim's `format=jsonv2` response body: an array of matches, best
 * guess first. Reads `[0].lat` / `[0].lon` — NOTE Nominatim returns these as STRINGS,
 * not numbers, so both are coerced via Number(). Returns null for anything that isn't a
 * well-formed match: not an array, an empty array, or a missing/blank/non-numeric lat
 * or lon. Never throws. Unit-tested directly — see tests/unit/geocode.test.ts.
 */
export function parseNominatimResponse(json: unknown): GeocodeResult | null {
  if (!Array.isArray(json) || json.length === 0) return null

  const first = json[0]
  if (!first || typeof first !== 'object') return null

  const { lat, lon } = first as Record<string, unknown>
  if (typeof lat !== 'string' && typeof lat !== 'number') return null
  if (typeof lon !== 'string' && typeof lon !== 'number') return null

  const parsedLat = toFiniteNumber(lat)
  const parsedLng = toFiniteNumber(lon)
  if (parsedLat === null || parsedLng === null) return null

  return { lat: parsedLat, lng: parsedLng }
}

/**
 * Best-effort geocode of an address via Nominatim. NEVER throws — any error (blank
 * address, network failure, timeout, non-2xx, unparseable body) resolves to `null`.
 * Serial callers only: Nominatim's usage policy caps free use to 1 request/second (see
 * the module header) — this function does not rate-limit itself, so a caller issuing
 * several MUST space them out (see the backfill action).
 */
export async function geocodeAddress(parts: AddressParts): Promise<GeocodeResult | null> {
  const query = buildGeocodeQuery(parts)
  if (!query) return null

  const contact = process.env.NOMINATIM_CONTACT || DEFAULT_CONTACT
  const url = `${NOMINATIM_ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `property-ops/1.0 (${contact})` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[geocode] Nominatim responded', res.status)
      return null
    }
    const json = await res.json().catch(() => null)
    return parseNominatimResponse(json)
  } catch (e) {
    console.error('[geocode] request failed:', e)
    return null
  }
}
