# Property Ops — Map View (Track M) — Design

**Date:** 2026-07-09 · **Status:** approved · **Depends on:** S1 (CSP already
pre-allows tile hosts), Track D shipped (this replaces `/preview/map`)

A `/map` page plotting the portfolio's properties as pins on an interactive map, plus
one-time geocoding of property addresses. Stack (decided): **Leaflet + OpenStreetMap
tiles + Nominatim geocoding** — free, no API keys, self-host-compatible. `leaflet` is
an **approved dependency** (the project's first new one; roadmap v2 §2).

**Privacy boundary:** the only data that ever leaves the app is a property's street
address, sent once to Nominatim for geocoding. Never tenant, finance, ticket, or
document data.

Read roadmap v2 §2 (hard rules) first.

---

## 1. Data — migration 0024

Idempotent; fold into `schema_bundle.sql`. No RLS change (columns ride the existing
`properties` policies — read allowed to workspace members, write to managers).

```sql
alter table public.properties
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz;
```

`Property` type in `src/types/domain.ts` gains the three fields (nullable).
**USER action:** run migration 0024.

## 2. Geocoding — `src/lib/geocode.ts`

Disconnected-integration pattern (reference: `src/lib/email/send.ts`): raw `fetch`,
best-effort, never throws, no SDK.

- `geocodeAddress(parts: { line1, postalCode, city, country }): Promise<{ lat, lng } | null>`
  → `GET https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=<encoded "line1, postalCode city, country">`
  with headers `User-Agent: property-ops/1.0 (<contact email env NOMINATIM_CONTACT or a default>)`
  (required by Nominatim's usage policy) and a 5s `AbortSignal.timeout`. Parse
  `[0].lat/lon` as floats; any error/empty → `null`.
- Pure helper `buildGeocodeQuery(parts): string` — unit-testable formatting/trimming.
- **Policy compliance:** max 1 request/second — callers must serialize (see backfill).

**Write path:** in `createPropertyAction` / `updatePropertyAction`
(`src/app/(app)/properties/actions.ts`), after a successful save: if creating, or if
any address field changed (compare against the fetched current row), call
`geocodeAddress` best-effort and, on success, update `latitude/longitude/geocoded_at`
via the same RLS-scoped server client (the manager is already authorized to write this
row; no service client needed). Failure leaves them null — never blocks or errors the save. Address change
with failed re-geocode → null the stale coords (a wrong pin is worse than no pin).

**Backfill:** on `/map`, a manager-only "Locate N missing" button → server action that
loops the workspace's null-coord ACTIVE properties **sequentially with a 1.1s delay**
(portfolios are small; cap at 20 per click), then `revalidatePath('/map')`.

## 3. UI — `/map`

- **Nav:** Portfolio group → "Map" (icon: `MapPinned`), `properties:read`-gated, after
  Properties. Remove `/preview/map` + its nav entry in the same commit (Track D swap rule).
- **Page** (`src/app/(app)/map/page.tsx`, server): `requirePermission('properties:read')`;
  fetch ACTIVE properties + per-property unit count and open-ticket count (reuse the
  existing list/data helpers; a simple JS aggregate over `listTickets` statuses is fine
  at this scale); render `PageHeader` ("Map", subtitle), the backfill button (managers,
  only when some coords are null), a "N of M properties located" note, and
  `<PropertyMap properties={located} />`.
- **`src/components/map/PropertyMap.tsx`** (`'use client'`): dynamically import
  Leaflet (`next/dynamic`, `ssr: false` wrapper component) — Leaflet touches `window`
  at import. Import `leaflet/dist/leaflet.css` there. Fix the well-known default
  marker-asset issue by using `L.divIcon` **custom markers** (a graphite pin via
  Tailwind classes — also solves dark mode) instead of shipping the PNG defaults.
  Map: OSM tile layer (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, standard
  attribution control — required by OSM), `fitBounds` of all pins (single pin → zoom
  16), scroll-wheel zoom enabled, `className` applying a subtle
  `grayscale-[0.85] contrast-[0.9]` filter on the tile pane for the graphite look
  (keep popups/pins unfiltered).
- **Popup per pin:** property name (link → `/properties/[id]`), address line, "X units
  · Y open tickets" (StatusBadge tones not needed — plain text), styled to match
  `bg-popover` (override Leaflet popup CSS minimally in the component's module scope or
  globals — keep overrides ≤ ~20 lines).
- **Empty states:** no properties → existing `EmptyState` pattern; none geocoded →
  EmptyState with the backfill button as the action.
- **Mobile:** map container `h-[60vh] min-h-80 w-full rounded-lg border overflow-hidden`;
  touch pan/zoom are Leaflet defaults. The properties **list** page remains the
  accessible/keyboard alternative (note in page subtitle not needed — popups are
  keyboard-reachable via Leaflet's tab support, good enough).

## 4. Config

- `package.json`: add `leaflet` + dev `@types/leaflet` (pinned caret versions).
- CSP (from S1): `img-src` already allows `https://*.tile.openstreetmap.org`; tiles are
  images only, no `connect-src` change (Nominatim is called server-side).
- Env: optional `NOMINATIM_CONTACT` (email for the User-Agent; falls back to a
  hardcoded project string).

## 5. Testing & acceptance

- Unit (`tests/unit/geocode.test.ts`): `buildGeocodeQuery` formatting; response-parse
  helper (valid, empty array, garbage, non-numeric) — factor parsing into a pure
  `parseNominatimResponse(json)` for this.
- Existing suites stay green; no RLS review needed (0024 adds nullable columns only —
  still fold into `schema_bundle.sql`).
- Manual: create a property with a real Vienna address → pin appears after save;
  edit address → pin moves (or clears on geocode failure); backfill locates seeded
  properties; popup links navigate; dark mode legible; phone viewport pans/zooms.
- Acceptance: `/map` shows every geocoded ACTIVE property; ungeocoded ones are counted
  + locatable via the button; zero console CSP violations; `npm run build` bundle for
  the route stays lazy (Leaflet not in the shared client chunk — verify via build
  output route sizes).

## 6. Risks

- **Nominatim misses** on odd addresses → coords stay null, property listed in the
  "not located" count; manual fix path = edit address to a cleaner form. (Manual
  pin-drag placement is a backlog nicety, not v1.)
- **OSM tile usage policy:** fine for this scale; self-host later can point the tile
  URL at a paid/self-hosted tile server via one constant.
- **Leaflet + React 19/Compiler:** keep all Leaflet mutation inside a `useEffect` with
  a ref'd container and a cleanup that `map.remove()`s; no Leaflet state in render.
