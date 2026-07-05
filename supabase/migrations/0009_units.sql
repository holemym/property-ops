-- =============================================================================
-- Migration 0009: Units + Row Level Security
-- =============================================================================
-- Adds `public.units` — the per-property inventory of rentable/occupiable spaces
-- (apartments, offices, etc.) — plus its two table-specific enums (occupancy_type,
-- unit_status). This migration is a near-verbatim COPY of the 0003 properties
-- template; read 0003's header for the shared rationale (open-select isolation
-- boundary, fail-closed RLS-in-same-file, SUPER_ADMIN read-only override). Only
-- the units-specific deltas are re-documented here.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006, 0007, 0008.
-- This is the next free lexical number, 0009 — numbered by apply position, not by
-- the plan task id (Task 18).
--
-- SHARED TYPE NOTE: `public.entity_status` was created ONCE in 0003 and is NOT
-- re-created here (a naive copy that left that line in would fail on apply). Units
-- do not use entity_status at all — they carry their own `unit_status` lifecycle
-- enum (OCCUPIED / VACANT / MAINTENANCE / BLOCKED), which is distinct from the
-- ACTIVE / ARCHIVED portfolio lifecycle. Both `occupancy_type` and `unit_status`
-- below are table-specific and created here for the first time.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role, and
-- is_workspace_manager all exist from 0001/0002 and are REUSED, not redefined. As
-- of 0008, is_workspace_manager() also requires the caller be is_active (via
-- create or replace); the policies below reference it by name and evaluate its
-- CURRENT body per query, so a deactivated manager is blocked from these
-- INSERT/UPDATE policies with no change to this file.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it
-- exists, so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create type public.occupancy_type as enum ('LONG_TERM', 'SHORT_TERM', 'VACANT', 'MIXED');
create type public.unit_status as enum ('OCCUPIED', 'VACANT', 'MAINTENANCE', 'BLOCKED');

-- -----------------------------------------------------------------------------
-- COMPOSITE-FK INTEGRITY (the units-specific hardening beyond the 0003 template)
--
-- A unit carries BOTH a workspace_id and a property_id, and the unit's workspace_id
-- MUST equal the workspace_id of the property it references. A plain
-- `property_id references properties(id)` does NOT enforce this: FK validation
-- checks ROW EXISTENCE and BYPASSES RLS. So a manager in workspace X, whose insert
-- passes the WITH CHECK below (the NEW unit row's workspace_id = X = their own),
-- could still set property_id to a property owned by workspace Y — they cannot
-- SELECT that property, but they can GUESS/obtain its id, and the FK would happily
-- validate its existence. Result: a cross-workspace dangling reference (a unit in X
-- pointing at Y's property), invisible to normal reads but corrupting the data model.
--
-- Fix: the standard multi-tenant COMPOSITE-FK pattern. We add a UNIQUE(id,
-- workspace_id) on properties (additive, no data exists anywhere, so it is a safe
-- alter on the existing table), then reference (property_id, workspace_id) as a
-- pair. Postgres then requires that a property with THAT id AND THAT workspace_id
-- exists — so the unit's workspace_id must match its property's. A cross-workspace
-- property_id no longer validates: no properties row has (Y's property id, X) as a
-- (id, workspace_id) pair, so the FK rejects the insert at the DB layer regardless
-- of RLS. The friendly app-layer ownership check in createUnitAction is the
-- first line of defense; this FK is the un-bypassable backstop.
-- -----------------------------------------------------------------------------
alter table public.properties
  add constraint properties_id_workspace_unique unique (id, workspace_id);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  label text not null,
  floor text,
  staircase text,
  size_m2 numeric,
  room_count int,
  occupancy_type public.occupancy_type not null default 'VACANT',
  status public.unit_status not null default 'VACANT',
  -- FREE-TEXT VISIBILITY (same open-select audience rule as 0003's `notes`): under
  -- units_select_workspace below (gated on membership, NOT role), these four text
  -- columns are readable by any workspace member hitting PostgREST directly,
  -- including future TENANT / GUEST / VENDOR sessions. Nuance worth stating:
  --   * access_notes / wifi_info / heating_info are arguably TENANT-USEFUL — Phase 3
  --     tenants may legitimately need the wifi password or heating instructions for
  --     their own unit, so workspace-wide readability is defensible for these.
  --   * general_notes is the OPERATOR SCRATCHPAD — it is NOT tenant-facing by intent.
  -- REGARDLESS of that distinction, the 0003 rule holds for ALL of them: internal-only
  -- remarks (staff door codes, key-safe combinations, tenant assessments, owner phone
  -- numbers) do NOT belong in any of these columns, because none are manager-gated.
  -- When Phase 3 needs manager-private per-unit remarks, add a SEPARATE structure
  -- (an internal_notes column/table with its own manager-only RLS), rather than
  -- silently widening one of these columns' audience assumptions.
  access_notes text,
  wifi_info text,
  heating_info text,
  general_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK: a unit's (property_id, workspace_id) must exist as a properties
  -- (id, workspace_id) pair — enforcing property/unit workspace consistency (see the
  -- COMPOSITE-FK INTEGRITY block above). on delete cascade: deleting a property (or,
  -- transitively, a workspace) removes its units.
  constraint units_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete cascade
);

create index units_workspace_id_idx on public.units (workspace_id);
create index units_property_id_idx on public.units (property_id);

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003): a caller whose
-- current_workspace_id() is NULL matches no rows (`workspace_id = NULL` -> NULL ->
-- excluded), and current_role() is NULL only for a caller with no profile row,
-- which likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.units enable row level security;

-- SELECT: gated on WORKSPACE MEMBERSHIP ONLY (plus the SUPER_ADMIN platform
-- override), NOT on role — the same deliberate open-select design as 0003's
-- properties_select_workspace. RLS is the TENANT-ISOLATION boundary (workspace X's
-- units invisible to workspace Y); finer per-role UX hiding stays at the app layer
-- (units pages call requirePermission('units:read')). Phase 3 tickets need tenants
-- to resolve the unit a maintenance request is raised against, so pinning role in
-- RLS would break legitimate cross-references for no isolation benefit.
--
-- SUPER_ADMIN NOTE: the platform override here applies to SELECT ONLY. A SUPER_ADMIN
-- has workspace_id = NULL, so they read across workspaces but their WRITES are
-- rejected by the WITH CHECK below (NULL workspace -> `workspace_id = NULL` -> NULL
-- -> three-valued-logic rejection). Platform reach is READ-ONLY oversight; writing
-- to a workspace's units requires actual membership.
create policy "units_select_workspace"
  on public.units for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

-- INSERT: managers only (SUPER_ADMIN / OWNER / OPERATOR via is_workspace_manager(),
-- which excludes ACCOUNTANT -> read-only), and only within their own workspace. No
-- SUPER_ADMIN platform override on writes (see SUPER_ADMIN NOTE above). Named
-- units_insert_manager (insert, not "write").
create policy "units_insert_manager"
  on public.units for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- UPDATE: managers only, own workspace. EXPLICIT WITH CHECK (not relying on the
-- implicit "defaults to USING" behavior): WITH CHECK re-validates the NEW row, so an
-- `UPDATE ... SET workspace_id = <other workspace>` (a workspace-hop) is rejected —
-- the post-update workspace_id would no longer equal current_workspace_id(). Spelled
-- out so the safe pattern survives being copied to the next domain table.
create policy "units_update_manager"
  on public.units for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — intentional, same as 0003. RLS default-denies any command
-- without a matching policy, so DELETE is closed through the API. Units are removed
-- by cascade when their property/workspace is deleted, not by direct hard-delete.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X can
--    INSERT, UPDATE, and SELECT units belonging to X.
-- 2. Any user in workspace Y SELECTs ZERO of workspace X's units (tenant isolation
--    — the core guarantee).
-- 3. An ACCOUNTANT in X can SELECT X's units but CANNOT INSERT or UPDATE them
--    (is_workspace_manager() excludes ACCOUNTANT) — matching units:read without
--    units:write.
-- 4. A TENANT / GUEST / VENDOR in X CAN SELECT X's units at the RLS layer (workspace
--    membership only). They are still blocked from the units UI by
--    requirePermission('units:read') at the app layer (RLS = isolation, matrix = UX).
-- 5. A deactivated manager in X (is_active = false) is REJECTED on INSERT and UPDATE:
--    0008 made is_workspace_manager() is_active-aware, and these policies call it by
--    name, so the block takes effect with no change to this file.
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a manager in Y running
--    `INSERT INTO units (..., workspace_id) VALUES (..., <workspace X's id>)` is
--    rejected by units_insert_manager's WITH CHECK (NEW.workspace_id != current).
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a manager in X running
--    `UPDATE units SET workspace_id = <Y's id> WHERE ...` on a row they own is
--    rejected by units_update_manager's WITH CHECK.
-- 8. ADVERSARIAL — cross-workspace property reference rejected by the COMPOSITE FK:
--    a manager in X running
--    `INSERT INTO units (workspace_id, property_id, label, ...)
--     VALUES (<X's id>, <a property owned by workspace Y>, 'Unit 1', ...)`
--    is REJECTED by units_property_fk — no properties row has (Y's property id, X)
--    as a (id, workspace_id) pair, so the FK fails existence even though the WITH
--    CHECK (which only inspects the unit's own workspace_id) would have passed. This
--    is the un-bypassable backstop for the FK-bypasses-RLS gap.
-- 9. No user (any role) can DELETE a unit through the API — no DELETE policy, so RLS
--    default-denies it.
-- =============================================================================
