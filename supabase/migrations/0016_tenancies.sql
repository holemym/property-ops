-- =============================================================================
-- Migration 0016: Tenancies (time-ranged occupancy) + Row Level Security
-- =============================================================================
-- Adds `public.tenancies` — a per-unit, time-ranged occupancy record that drives
-- the occupancy timeline. Where `units.status` is a POINT-IN-TIME ops flag
-- (OCCUPIED / VACANT / MAINTENANCE / BLOCKED), a tenancy expresses "unit U was
-- occupied by tenant T from start_date to end_date". This is the minimal model the
-- tape chart needs; MAINTENANCE / BLOCKED still come from unit.status and override
-- the visual, OCCUPIED spans come from covering tenancies.
--
-- This migration follows the 0003 properties / 0009 units TEMPLATE. Read 0003's
-- header for the shared rationale (fail-closed RLS-in-same-file, SUPER_ADMIN
-- read-only write override, three-valued-logic NULL safety). Only the
-- tenancies-specific deltas are documented here.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006–0015. This is the
-- next free lexical number, 0016 — numbered by apply position.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role, and
-- is_workspace_manager all exist from 0001/0002 and are REUSED, not redefined. As
-- of 0008, is_workspace_manager() also requires the caller be is_active (via
-- create or replace); the policies below reference it by name and evaluate its
-- CURRENT body per query, so a deactivated manager is blocked from the INSERT /
-- UPDATE policies with no change to this file.
--
-- COMPOSITE-FK INTEGRITY (same pattern as 0009's units_property_fk): a tenancy
-- carries BOTH a workspace_id and a unit_id, and the tenancy's workspace_id MUST
-- equal the workspace_id of the unit it references. A plain
-- `unit_id references units(id)` does NOT enforce this — FK validation checks ROW
-- EXISTENCE and BYPASSES RLS, so a manager in workspace X could set unit_id to a
-- unit owned by workspace Y (guessing its id) and create a cross-workspace dangling
-- reference. `units` already carries `units_id_workspace_unique unique (id,
-- workspace_id)` (added in 0011), so we reference the (unit_id, workspace_id) PAIR:
-- Postgres then requires a units row with THAT id AND THAT workspace_id to exist, so
-- a cross-workspace unit_id no longer validates. The app-layer ownership check is
-- the first line of defense; this FK is the un-bypassable backstop.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it
-- exists, so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  unit_id uuid not null,
  -- tenant_name / tenant_contact are PII (a rental roster). Unlike properties/units
  -- free-text, this table is NOT open-select — SELECT is role-gated below so
  -- TENANT / GUEST / VENDOR sessions cannot read the tenant roster.
  tenant_name text not null,
  tenant_contact text,
  start_date date not null,
  -- end_date null = open-ended / month-to-month (no scheduled move-out).
  end_date date,
  -- rent_amount: captured now for the future rent roll; UNUSED by the timeline.
  rent_amount numeric,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite FK: a tenancy's (unit_id, workspace_id) must exist as a units
  -- (id, workspace_id) pair — enforcing unit/tenancy workspace consistency (see the
  -- COMPOSITE-FK INTEGRITY block above). on delete cascade: deleting a unit (or,
  -- transitively, its property/workspace) removes its tenancies.
  constraint tenancies_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete cascade
);

-- Timeline queries fetch a workspace's tenancies filtered by unit; index the pair.
create index tenancies_workspace_unit_idx on public.tenancies (workspace_id, unit_id);

create trigger tenancies_set_updated_at
  before update on public.tenancies
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003/0009): a caller whose
-- current_workspace_id() is NULL matches no rows (`workspace_id = NULL` -> NULL ->
-- excluded), and current_role() is NULL only for a caller with no profile row,
-- which likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.tenancies enable row level security;

-- SELECT: ROLE-GATED, NOT open-select. This is the deliberate departure from the
-- 0003/0009 properties/units open-select template: tenancies carry tenant PII (the
-- rental roster), so read access is restricted to the manager+accountant roles
-- (SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT) within the workspace, plus the
-- SUPER_ADMIN platform read-only override. TENANT / GUEST / VENDOR sessions — even
-- though they are real workspace members and CAN read properties/units — get ZERO
-- tenancy rows: they have no roster access. This mirrors the
-- tickets_select_manager_or_accountant pattern (0011).
create policy "tenancies_select_manager_or_accountant"
  on public.tenancies for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT: managers only (SUPER_ADMIN / OWNER / OPERATOR via is_workspace_manager(),
-- which excludes ACCOUNTANT -> read-only), and only within their own workspace. No
-- SUPER_ADMIN platform override on writes (a SUPER_ADMIN has workspace_id = NULL, so
-- `workspace_id = current_workspace_id()` -> NULL -> rejected; platform reach is
-- read-only oversight, writing requires actual membership).
create policy "tenancies_insert_manager"
  on public.tenancies for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- UPDATE: managers only, own workspace. EXPLICIT WITH CHECK (not relying on the
-- implicit "defaults to USING" behavior): WITH CHECK re-validates the NEW row, so an
-- `UPDATE ... SET workspace_id = <other workspace>` (a workspace-hop) is rejected —
-- the post-update workspace_id would no longer equal current_workspace_id(). Spelled
-- out so the safe pattern survives being copied to the next domain table.
create policy "tenancies_update_manager"
  on public.tenancies for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — intentional, same as 0003/0009. RLS default-denies any command
-- without a matching policy, so DELETE is closed through the API. A tenancy is
-- ENDED by setting end_date (an UPDATE), not hard-deleted; rows are removed only by
-- cascade when their unit/property/workspace is deleted.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X can
--    INSERT, UPDATE, and SELECT tenancies belonging to X.
-- 2. An ACCOUNTANT in X can SELECT X's tenancies (occupancy:read oversight) but
--    CANNOT INSERT or UPDATE them (is_workspace_manager() excludes ACCOUNTANT) —
--    read-only, matching occupancy:read without any write permission.
-- 3. An OPERATOR in X can SELECT AND write (INSERT/UPDATE) X's tenancies
--    (is_workspace_manager() includes OPERATOR).
-- 4. PII ISOLATION — a TENANT / GUEST / VENDOR in X SELECTs ZERO tenancies. Unlike
--    properties/units (open-select, workspace-membership only), the SELECT policy
--    here pins role to manager+accountant, so the tenant roster is invisible to
--    these roles even within their own workspace. This is the core PII guarantee.
-- 5. Any user in workspace Y SELECTs ZERO of workspace X's tenancies (tenant
--    isolation — the cross-workspace guarantee).
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a manager in Y running
--    `INSERT INTO tenancies (..., workspace_id) VALUES (..., <workspace X's id>)`
--    is rejected by tenancies_insert_manager's WITH CHECK (NEW.workspace_id !=
--    current_workspace_id()) — no cross-workspace row planting.
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a manager in X running
--    `UPDATE tenancies SET workspace_id = <Y's id> WHERE ...` on a row they own is
--    rejected by tenancies_update_manager's WITH CHECK.
-- 8. ADVERSARIAL — cross-workspace unit reference rejected by the COMPOSITE FK:
--    a manager in X running
--    `INSERT INTO tenancies (workspace_id, unit_id, tenant_name, start_date, ...)
--     VALUES (<X's id>, <a unit owned by workspace Y>, 'Jane Doe', '2026-01-01', ...)`
--    is REJECTED by tenancies_unit_fk — no units row has (Y's unit id, X) as a
--    (id, workspace_id) pair, so the FK fails existence even though the WITH CHECK
--    (which only inspects the tenancy's own workspace_id) would have passed. This is
--    the un-bypassable backstop for the FK-bypasses-RLS gap.
-- 9. A deactivated manager in X (is_active = false) is REJECTED on INSERT and UPDATE:
--    0008 made is_workspace_manager() is_active-aware, and these policies call it by
--    name, so the block takes effect with no change to this file.
-- 10. No user (any role) can DELETE a tenancy through the API — no DELETE policy, so
--     RLS default-denies it. A tenancy is ended via end_date (UPDATE), and rows are
--     removed only by cascade.
-- =============================================================================
