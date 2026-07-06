# Occupancy Timeline + Minimal Tenancy Model — Design Spec (2026-07-06)

Standalone feature (user decision 2026-07-06: "just the timeline now"). Analytics + finance-light
(the Phase 3.5 spec) are DEFERRED until we've lived with this. Goal: a read-only "tape chart" —
units × time, occupancy color-coded, maintenance tickets pinned as preview markers.

Stack unchanged: Next.js 16.2.10 (read node_modules/next/dist/docs/ if unsure), shadcn wraps
@base-ui/react (`render` not `asChild`), Tailwind v4, graphite design system (reuse StatusBadge,
PageHeader, EmptyState, Skeleton, Card). Keep build/lint/test (133 baseline) green. The migration's
RLS gets an adversarial review gate before it's considered done (project norm for anything RLS).

## Why a new model
`unit.status` is a point-in-time enum — it can't express "occupied Jan–Mar, vacant Apr". A timeline
needs time-ranged occupancy. Minimal addition: a `tenancies` table. `unit.status` stays as the
point-in-time ops flag (MAINTENANCE/BLOCKED still override the visual); tenancies drive the spans.

## Migration `0016_tenancies.sql`
`public.tenancies` (follows the 0003/0009 template — RLS enabled in the SAME file; composite FK):
- id uuid pk; workspace_id uuid not null → workspaces (cascade)
- unit_id uuid not null; composite FK `(unit_id, workspace_id)` → `units (id, workspace_id)` (cascade)
- tenant_name text not null; tenant_contact text null (email/phone — no separate contacts model yet)
- start_date date not null; end_date date null (null = open-ended / month-to-month)
- rent_amount numeric null (captured now for the future rent roll; unused by the timeline)
- notes text null; created_by_user_id uuid not null → profiles(id)
- created_at, updated_at (+ set_updated_at trigger)
- index (workspace_id, unit_id)

RLS — tenancies carry tenant PII, so NOT open-select (unlike units):
- SELECT: `workspace_id = current_workspace_id() and current_role() in
  ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT')` OR `current_role() = 'SUPER_ADMIN'`.
  TENANT/GUEST/VENDOR: zero (no roster access).
- INSERT/UPDATE: `workspace_id = current_workspace_id() and is_workspace_manager()` (explicit WITH
  CHECK; is_active-aware via 0008). Accountant read-only.
- No DELETE policy (end a tenancy by setting end_date; default-deny delete).
- OVERLAP: v1 does NOT hard-enforce non-overlapping tenancies per unit (would need btree_gist +
  daterange EXCLUDE). Documented as a known gap; the create form warns on overlap at the app layer.

Append the same to `supabase/schema_bundle.sql`. Include a SMOKE TESTS comment block (per norm).

## Permissions
Add `occupancy:read` → SUPER_ADMIN, OWNER, OPERATOR, ACCOUNTANT (managers + accountant). Page gates
on it; RLS is the real boundary.

## Data + derivation
- `src/lib/data/tenancies.ts` — `listTenancies(supabase, workspaceId)` (+ createTenancy action,
  manager-gated, composite ownership check). RLS-scoped.
- Pure helper `src/lib/occupancy/timeline.ts` — given units + tenancies + a date window, produce per
  unit an array of segments {from, to, state: OCCUPIED|VACANT|MAINTENANCE|BLOCKED, tenantName?}.
  MAINTENANCE/BLOCKED come from `unit.status`; OCCUPIED from a covering tenancy; else VACANT.
  Unit-tested with fixtures (no DB).

## UI
- Route `src/app/(app)/occupancy/page.tsx` + `loading.tsx`. `requirePermission('occupancy:read')`.
- Sidebar: add "Occupancy" (managers + accountant; hidden from tenants), between Units and Vendors.
- Timeline: units grouped by property (rows) × a rolling window (default 6 months from the current
  month; simple prev/next later — v1 fixed window). Occupancy spans colored by state (graphite +
  status tones: occupied=accent, vacant=warning, maintenance/blocked=danger). Ticket markers: open
  tickets for the unit within the window, dot colored by priority; hover/click → a preview popover
  (title + StatusBadge status/priority + vendor) linking to `/tickets/[id]`. READ-ONLY ("preview").
- EmptyState when there are no units. Reuse the graphite card/tokens; reduced-motion aware.

## Seed (so the timeline isn't empty locally/live)
Add ~6 tenancies across the seeded units (some open-ended, some ended mid-window, some vacant units
left with no tenancy) via a small SQL block appended to the seed — so the tape chart shows real spans.

## Tests
- `timeline.ts` pure-fn unit tests (fixtures → expected segments). Adds to the 133 baseline.
- `tests/rls/tenancies.rls-test.ts` — manager writes; accountant reads; operator reads; tenant zero;
  cross-workspace blocked. Env-gated (`npm run test:rls`).

## Non-goals (v1)
No lease documents/renewals workflow, no rent roll report, no tenant directory/contacts model, no
overlap enforcement, no editable window beyond the fixed 6-month view, no drag-to-reschedule. Those
are follow-ups once the timeline earns its keep.

## Build order
1. Migration 0016 + RLS + `occupancy:read` perm → RLS review gate.
2. Data layer + `timeline.ts` + unit tests.
3. Occupancy page + loading + sidebar nav.
4. Seed tenancies; verify live on localhost:3001; RLS tests.
