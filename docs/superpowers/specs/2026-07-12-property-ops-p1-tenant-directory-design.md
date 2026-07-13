# P1 — Tenant directory (People) — Design

**Date:** 2026-07-12 · **Status:** approved (Fable design pass) · Replaces the
`[plan]` placeholder; board tasks P1-1..P1-4.

Tenants graduate from names-on-tenancies to real contact records. This completes the
data model (person ↔ lease are different things), unlocks future communication
features, and replaces `/preview/people`.

## 1. Data — migration 0025 `[rls review required]`

New table `public.tenants` — follow the 0016 tenancies file as the template for
conventions (fail-closed RLS in-file, explicit WITH CHECK, no DELETE, set_updated_at
trigger, workspace index):

```
id uuid pk default gen_random_uuid()
workspace_id uuid not null references workspaces(id) on delete cascade
full_name text not null
email text
phone text
language text            -- BCP-47-ish tag, e.g. 'de', 'en'; nullable; used by P4 later
notes text
created_by_user_id uuid not null references profiles(id)
created_at / updated_at timestamptz not null default now()
constraint tenants_id_workspace_unique unique (id, workspace_id)   -- composite-FK anchor
```

**RLS (PII posture identical to tenancies/0016):** SELECT gated to
manager+accountant (`current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT')`
+ workspace pin) — NOT open-select; INSERT/UPDATE `is_workspace_manager()` +
workspace pin both sides; **no DELETE** (directory entries are history-bearing).

**Link from tenancies:** `alter table tenancies add column if not exists tenant_id
uuid;` + composite FK `(tenant_id, workspace_id) → tenants(id, workspace_id)` MATCH
SIMPLE, `on delete set null`. `tenant_name` STAYS — it remains the display fallback
and the record for pre-P1 rows; when a tenancy has a `tenant_id`, the UI shows the
linked tenant's name.

Trigram index for search: `create index if not exists tenants_full_name_trgm on
public.tenants using gin (full_name gin_trgm_ops);` (+ email). Fold everything into
`schema_bundle.sql`. Demo reset function (0023) is unaffected — but ADD `delete from
public.tenants where workspace_id = demo_ws;` to `reset_demo_workspace()` (before
properties delete) in the same migration via `create or replace`, so demo visitors'
directory writes get wiped too. **This is a policy-adjacent change → rls review.**

## 2. Permissions

New `tenants:read` / `tenants:write` in `src/lib/auth/permissions.ts`, granted exactly
like `occupancy:read` + finance-style write: read → all manager roles + ACCOUNTANT;
write → managers only (`MANAGER_PERMISSIONS`). Tenant/guest/vendor roles get neither.

## 3. Data layer — `src/lib/data/tenants.ts`

`listTenants(supabase, workspaceId, {search?})` (ilike on full_name/email, sorted by
full_name) · `getTenant` · `createTenant` · `updateTenant` — mirror
`src/lib/data/vendors.ts` conventions exactly (typed Row, `as unknown as`, throw on
error). Plus `listTenanciesForTenant(supabase, workspaceId, tenantId)`.
Zod: `src/lib/validation/tenant.ts` (full_name min 1 required; email
`z.string().email()` optional-or-empty→null; phone/language/notes optional).

## 4. UI

- **Nav:** Portfolio group → "People" (icon `Contact`), after Rent roll,
  `tenants:read`-gated. **Delete `/preview/people` + its nav entry in the same commit
  the real list ships** (swap rule).
- **`/people`** — PageHeader ("People", "Tenant contact records across your
  portfolio."), search-by-name form (house pattern from /properties), responsive
  table→cards (house pattern from VendorTable): Name · Contact (email/phone stacked) ·
  Language · linked-tenancy count. Row-click → detail (stretched-link house pattern
  with the focus-ring treatment). EmptyState (icon `Contact`) with "Add person" CTA.
  "New person" PageHeader action (`tenants:write`).
- **`/people/new` + `/people/[id]`** — form pages via a shared `TenantForm`
  (mirror `VendorForm`); detail page also shows: linked tenancies card (unit label,
  property, span via `formatDate`, rent — from `listTenanciesForTenant`) and an
  EmptyState when none.
- **Tenancy picker:** `NewTenancyDialog` gains an optional "Person" `<select>`
  (listTenants) above the tenant-name field; choosing one sets `tenant_id` AND
  auto-fills `tenant_name` (kept in sync server-side in `createTenancy`: if
  `tenantId` provided, resolve the tenant server-side and write its `full_name` into
  `tenant_name` — never trust the client copy). Free-text name without a linked
  person remains fully supported.
- **Search:** add `tenants` to `searchWorkspace` (`src/lib/data/search.ts`) — type
  `tenant` already exists in the palette's TYPE_META; today it matches
  tenancies.tenant_name, add the tenants table (full_name/email) as a second source,
  href `/people/[id]`.

## 5. Out of scope (v1 — do not build)

Ticket linkage (`created_for` profiles are a different concept from directory
tenants — reconciling them is its own future design), CSV import, merge/dedupe
tooling, tenant-portal self-service profile editing, is_active/archival.

## 6. Board decomposition

- **P1-1** `[builder]` `[rls]` — migration 0025 (+ demo-reset extension + bundle
  fold) + permissions + types + data layer + validation + unit tests (validation
  schema, data-layer against the fake client — mirror `data-vendors.test.ts`).
- **P1-2** `[builder]` — `/people` list + `TenantForm` + new/edit pages + nav entry +
  **delete `/preview/people`** + EmptyStates. Depends P1-1.
- **P1-3** `[builder]` — detail page tenancy card + `NewTenancyDialog` person picker +
  server-side name resolution in `createTenancy` + `searchWorkspace` tenants source +
  tests for the new pure branches. Depends P1-1 (parallel-safe with P1-2 except both
  tick the board — sequence them).
- **P1-4** `[verify]` — after USER runs 0025: create person → appears in list/search;
  link to new tenancy → name auto-fills, occupancy/rent-roll unchanged; RLS spot-check
  (accountant reads, cannot write); preview page gone from nav.

**USER queue addition:** run migration 0025 (after P1-1 lands).
