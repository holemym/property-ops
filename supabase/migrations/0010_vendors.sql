-- =============================================================================
-- Migration 0010: Vendors + Row Level Security
-- =============================================================================
-- Adds `public.vendors` — the workspace's directory of external service providers
-- (plumbers, electricians, cleaners, etc.) that maintenance work can be assigned to
-- in later phases — plus its table-specific `vendor_category` enum. This migration
-- is the THIRD copy of the 0003 properties template (after 0009 units); read 0003's
-- header for the shared rationale (fail-closed RLS-in-same-file, open-select
-- isolation boundary, SUPER_ADMIN read-only override). Only the vendors-specific
-- deltas are re-documented here.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006, 0007, 0008, 0009.
-- This is the next free lexical number, 0010 — numbered by apply position, not by
-- the plan task id (Task 21).
--
-- STANDALONE / NO COMPOSITE FK: unlike 0009 units (which references properties and
-- therefore needed the composite-FK machinery to enforce property/unit workspace
-- consistency), vendors reference NOTHING but workspaces. There is no other
-- workspace-scoped table in a vendor row, so there is no cross-workspace dangling-
-- reference risk to guard against, and thus NO `unique (id, workspace_id)` on this
-- table and no composite FK here.
--   FUTURE AUTHORS: when Phase-3 tickets introduce a table that REFERENCES vendors
--   (e.g. maintenance tickets / work orders assigned to a vendor), vendors will then
--   need exactly what 0009 did for properties: add `unique (id, workspace_id)` to
--   this table, and have the referencing table carry (vendor_id, workspace_id) as a
--   composite FK back to (id, workspace_id) here. Do not forget this when that ticket
--   lands — a plain `vendor_id references vendors(id)` bypasses RLS and permits a
--   cross-workspace dangling reference, the exact gap 0009's header explains.
--
-- LIFECYCLE — NOT entity_status: vendors do NOT use the shared `entity_status`
-- (ACTIVE / ARCHIVED) enum. They carry a plain `is_active boolean` lifecycle
-- (default true). Deactivation (is_active = false) is the soft-delete story — see the
-- "no DELETE policy" note below. `entity_status` is created once in 0003 and is not
-- touched here.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role, and
-- is_workspace_manager all exist from 0001/0002 and are REUSED, not redefined. As of
-- 0008, is_workspace_manager() also requires the caller be is_active; the policies
-- below reference it by name and evaluate its CURRENT body per query, so a
-- deactivated manager is blocked from these INSERT/UPDATE policies with no change to
-- this file.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists,
-- so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create type public.vendor_category as enum (
  'PLUMBING', 'HEATING', 'ELECTRICAL', 'CLEANING', 'LOCKSMITH',
  'APPLIANCE_REPAIR', 'HANDYMAN', 'PEST_CONTROL', 'OTHER'
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  service_category public.vendor_category not null default 'OTHER',
  -- FREE-TEXT VISIBILITY (same open-select audience rule as 0003's `notes` and 0009's
  -- unit note columns): under vendors_select_workspace below (gated on membership, NOT
  -- role), `notes` is readable by any workspace member hitting PostgREST directly,
  -- including future TENANT / GUEST / VENDOR sessions. So `notes` is workspace-visible
  -- operator scratchpad only — internal-only remarks (pricing disputes, private
  -- assessments of a contractor, do-not-rehire flags) do NOT belong here, because this
  -- column is not manager-gated. When Phase 3 needs manager-private vendor remarks, add
  -- a SEPARATE structure with its own manager-only RLS rather than widening this
  -- column's audience.
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vendors_workspace_id_idx on public.vendors (workspace_id);

create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003/0009): a caller whose
-- current_workspace_id() is NULL matches no rows (`workspace_id = NULL` -> NULL ->
-- excluded), and current_role() is NULL only for a caller with no profile row, which
-- likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.vendors enable row level security;

-- SELECT: gated on WORKSPACE MEMBERSHIP ONLY (plus the SUPER_ADMIN platform override),
-- NOT on role — the same deliberate open-select design as 0003/0009. RLS is the
-- TENANT-ISOLATION boundary (workspace X's vendors invisible to workspace Y); finer
-- per-role UX hiding stays at the app layer (vendors pages call
-- requirePermission('vendors:read')). Phase 3 tickets need tenants/operators to
-- resolve the vendor a maintenance request is assigned to, so pinning role in RLS
-- would break legitimate cross-references for no isolation benefit.
--
-- SUPER_ADMIN NOTE: the platform override here applies to SELECT ONLY. A SUPER_ADMIN
-- has workspace_id = NULL, so they read across workspaces but their WRITES are
-- rejected by the WITH CHECK below (NULL workspace -> `workspace_id = NULL` -> NULL ->
-- three-valued-logic rejection). Platform reach is READ-ONLY oversight; writing to a
-- workspace's vendors requires actual membership.
create policy "vendors_select_workspace"
  on public.vendors for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

-- INSERT: managers only (SUPER_ADMIN / OWNER / OPERATOR via is_workspace_manager(),
-- which excludes ACCOUNTANT -> read-only), and only within their own workspace. No
-- SUPER_ADMIN platform override on writes (see SUPER_ADMIN NOTE above).
create policy "vendors_insert_manager"
  on public.vendors for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- UPDATE: managers only, own workspace. EXPLICIT WITH CHECK (not relying on the
-- implicit "defaults to USING" behavior): WITH CHECK re-validates the NEW row, so an
-- `UPDATE ... SET workspace_id = <other workspace>` (a workspace-hop) is rejected —
-- the post-update workspace_id would no longer equal current_workspace_id(). Spelled
-- out so the safe pattern survives being copied to the next domain table. This same
-- UPDATE policy also governs the soft-delete path: `UPDATE vendors SET is_active =
-- false` is a manager-only, own-workspace update.
create policy "vendors_update_manager"
  on public.vendors for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — intentional, same as 0003/0009. RLS default-denies any command
-- without a matching policy, so DELETE is closed through the API. Vendors are never
-- hard-deleted through the app: the soft-delete story is `is_active = false` (via the
-- UPDATE policy above), which preserves referential history for any future work orders
-- that reference the vendor. Rows are still removed by cascade when the workspace is
-- deleted.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X can
--    INSERT, UPDATE, and SELECT vendors belonging to X.
-- 2. Any user in workspace Y SELECTs ZERO of workspace X's vendors (tenant isolation
--    — the core guarantee).
-- 3. An ACCOUNTANT in X can SELECT X's vendors but CANNOT INSERT or UPDATE them
--    (is_workspace_manager() excludes ACCOUNTANT) — matching vendors:read without
--    vendors:write. In particular an ACCOUNTANT cannot soft-delete (set is_active =
--    false), since that is an UPDATE.
-- 4. A TENANT / GUEST / VENDOR in X CAN SELECT X's vendors at the RLS layer (workspace
--    membership only). They are still blocked from the vendors UI by
--    requirePermission('vendors:read') at the app layer (RLS = isolation, matrix = UX).
-- 5. A deactivated manager in X (is_active = false) is REJECTED on INSERT and UPDATE:
--    0008 made is_workspace_manager() is_active-aware, and these policies call it by
--    name, so the block takes effect with no change to this file.
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a manager in Y running
--    `INSERT INTO vendors (..., workspace_id) VALUES (..., <workspace X's id>)` is
--    rejected by vendors_insert_manager's WITH CHECK (NEW.workspace_id != current).
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a manager in X running
--    `UPDATE vendors SET workspace_id = <Y's id> WHERE ...` on a row they own is
--    rejected by vendors_update_manager's WITH CHECK.
-- 8. No user (any role) can DELETE a vendor through the API — no DELETE policy, so RLS
--    default-denies it. Deactivation via is_active = false is the intended soft-delete.
-- =============================================================================
