-- =============================================================================
-- Migration 0011: Tickets (maintenance requests / work orders) + Row Level Security
-- =============================================================================
-- Adds `public.tickets` — the CENTRAL table of the product: a maintenance request
-- / work order raised against a property (and optionally a specific unit), reported
-- by a workspace member (often a TENANT), triaged and assigned by managers, and
-- optionally dispatched to a vendor. Plus its three table-specific enums
-- (ticket_category, ticket_priority, ticket_status).
--
-- This migration copies the 0003 properties template for the SHARED conventions
-- (fail-closed RLS-in-same-file, EXPLICIT WITH CHECK, SUPER_ADMIN read-only
-- override on writes, no-DELETE, composite-FK integrity from 0009). Read 0003's and
-- 0009's headers for that rationale. What is NEW here — and why this file is longer
-- and more carefully argued than 0009/0010 — is that tickets is the FIRST table
-- where different ROLES see different ROWS within the SAME workspace:
--   * managers (SUPER_ADMIN / OWNER / OPERATOR) and ACCOUNTANT see EVERY ticket in
--     their workspace;
--   * TENANT / GUEST / VENDOR see ONLY the tickets they themselves created.
-- So the SELECT policy is SPLIT into two OR'd policies (Postgres OR's multiple
-- permissive policies for the same command), not the single membership-gated
-- open-select of 0003/0009/0010. This is the template the rest of Phase 3 copies.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006, 0007, 0008,
-- 0009, 0010. This is the next free lexical number, 0011 — numbered by apply
-- position, not by the plan task id (P3.1).
--
-- SHARED TYPES: `public.entity_status` (0003) is NOT re-created here — tickets do
-- not use it; they carry their own `ticket_status` lifecycle enum. All three enums
-- below (ticket_category / ticket_priority / ticket_status) are table-specific and
-- created here for the first time.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role,
-- is_workspace_manager, current_is_active all exist from 0001/0002/0007/0008 and are
-- REUSED, not redefined. As of 0008, is_workspace_manager() is is_active-aware; the
-- UPDATE policy below references it by name and evaluates its CURRENT body per query,
-- so a deactivated manager is blocked from updating with no change to this file.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists,
-- so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create type public.ticket_category as enum (
  'PLUMBING', 'HEATING', 'ELECTRICAL', 'CLEANING', 'APPLIANCE',
  'INTERNET', 'KEYS', 'DAMAGE', 'NOISE', 'BILLING', 'OTHER'
);

create type public.ticket_priority as enum ('LOW', 'NORMAL', 'HIGH', 'URGENT');

create type public.ticket_status as enum (
  'NEW', 'TRIAGE', 'WAITING_FOR_INFO', 'ASSIGNED', 'SCHEDULED',
  'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED'
);

-- -----------------------------------------------------------------------------
-- COMPOSITE-FK PREREQUISITES (see 0009's COMPOSITE-FK INTEGRITY block for the full
-- rationale: FK validation checks ROW EXISTENCE and BYPASSES RLS, so a plain
-- `unit_id references units(id)` would let a manager in workspace X plant a ticket
-- referencing workspace Y's unit — a cross-workspace dangling reference invisible to
-- normal reads. The fix is the composite-FK pattern: reference (child_id,
-- workspace_id) as a PAIR against a UNIQUE(id, workspace_id) on the parent, so the
-- child's workspace_id must match its parent's or the FK rejects the row.)
--
-- properties already has `properties_id_workspace_unique` (added in 0009), so the
-- property_id composite FK below reuses it — nothing to add for properties.
--
-- units and vendors, however, LACK `unique (id, workspace_id)`:
--   * 0009 added a composite FK FROM units TO properties, but never added a
--     unique(id, workspace_id) ON units itself (nothing referenced units yet).
--   * 0010 vendors EXPLICITLY deferred it: its header says "when Phase-3 tickets
--     introduce a table that REFERENCES vendors ... add `unique (id, workspace_id)`
--     to this table". This is that migration.
-- Both are additive on tables with no data anywhere, so these ALTERs are safe.
-- Without them, the (unit_id, workspace_id) and (assigned_vendor_id, workspace_id)
-- composite FKs below would fail to create ("no unique constraint matching given
-- keys") — so these two ALTERs are load-bearing prerequisites, not nice-to-haves.
-- -----------------------------------------------------------------------------
alter table public.units
  add constraint units_id_workspace_unique unique (id, workspace_id);

alter table public.vendors
  add constraint vendors_id_workspace_unique unique (id, workspace_id);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- property_id: REQUIRED. Every ticket is raised against a property. Composite FK
  -- (property_id, workspace_id) -> properties(id, workspace_id) guarantees the
  -- referenced property lives in THIS ticket's workspace. on delete cascade: deleting
  -- a property (or, transitively, a workspace) removes its tickets.
  property_id uuid not null,

  -- unit_id: NULLABLE. A ticket may target a specific unit or the property at large
  -- (e.g. a building-wide heating outage). Composite FK (unit_id, workspace_id) ->
  -- units(id, workspace_id).
  --   NULLABLE-COMPOSITE-FK / MATCH SIMPLE SUBTLETY: Postgres FKs default to MATCH
  --   SIMPLE. Under MATCH SIMPLE, if ANY column of a multi-column FK is NULL, the FK
  --   is NOT CHECKED AT ALL — so a ticket with unit_id = NULL is allowed regardless of
  --   workspace_id, which is EXACTLY what we want (a property-level ticket with no
  --   unit). Because workspace_id is NOT NULL on this table, the only way a column of
  --   this pair is NULL is unit_id = NULL, i.e. the "no specific unit" case. When
  --   unit_id IS NOT NULL, BOTH columns are non-NULL, so the pair IS checked in full:
  --   (unit_id, workspace_id) must exist as a units (id, workspace_id) row, enforcing
  --   that a named unit belongs to this ticket's workspace. (MATCH FULL would reject a
  --   partially-NULL pair outright; we do NOT want that, since unit_id-NULL is
  --   legitimate.) on delete set null: deleting a unit detaches its tickets (setting
  --   unit_id back to NULL) rather than cascading them away — the ticket history
  --   against the property survives the unit going away.
  unit_id uuid,

  -- created_by_user_id: the REPORTER (may be a tenant). NOT NULL. This is the column
  -- the ownership-based SELECT/INSERT policies below pin to auth.uid(). References
  -- profiles(id) — a PLAIN FK (no composite): profiles is not workspace-scoped in the
  -- same "child belongs to parent workspace" sense (a profile HAS a workspace_id but a
  -- ticket does not embed the reporter's workspace to cross-check), and cross-workspace
  -- integrity for the reporter is enforced by the INSERT WITH CHECK (created_by =
  -- auth.uid(), and the caller's own workspace = the ticket's workspace).
  created_by_user_id uuid not null references public.profiles (id),

  -- created_for_user_id: OPTIONAL. When a manager files a ticket ON BEHALF OF a tenant
  -- (e.g. tenant phoned it in), created_by is the manager and created_for is the tenant.
  -- Plain FK to profiles(id); nullable.
  created_for_user_id uuid references public.profiles (id),

  -- assigned_operator_id: OPTIONAL. The operator handling the ticket. Plain FK to
  -- profiles(id); nullable. Set by managers via the UPDATE path (and forced NULL for
  -- non-managers on INSERT by the trigger below).
  assigned_operator_id uuid references public.profiles (id),

  -- assigned_vendor_id: OPTIONAL. The external vendor dispatched. NULLABLE composite FK
  -- (assigned_vendor_id, workspace_id) -> vendors(id, workspace_id) — same MATCH SIMPLE
  -- behavior as unit_id: NULL vendor => not checked (unassigned); non-NULL vendor =>
  -- must belong to this workspace. on delete set null: removing a vendor unassigns it
  -- from its tickets rather than deleting the tickets.
  assigned_vendor_id uuid,

  title text not null,
  description text not null,
  category public.ticket_category not null default 'OTHER',
  priority public.ticket_priority not null default 'NORMAL',
  status public.ticket_status not null default 'NEW',

  -- Cost tracking (accountant-relevant). Free numeric; no currency column yet.
  estimated_cost numeric,
  actual_cost numeric,

  scheduled_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Composite FK: ticket's (property_id, workspace_id) must exist as a properties
  -- (id, workspace_id) pair — property/ticket workspace consistency. REQUIRED column,
  -- so this pair is always fully checked.
  constraint tickets_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete cascade,

  -- Composite FK: ticket's (unit_id, workspace_id) must exist as a units
  -- (id, workspace_id) pair WHEN unit_id is non-NULL (MATCH SIMPLE; see the unit_id
  -- column comment). on delete set null.
  constraint tickets_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete set null,

  -- Composite FK: ticket's (assigned_vendor_id, workspace_id) must exist as a vendors
  -- (id, workspace_id) pair WHEN assigned_vendor_id is non-NULL (MATCH SIMPLE). on
  -- delete set null.
  constraint tickets_vendor_fk
    foreign key (assigned_vendor_id, workspace_id)
    references public.vendors (id, workspace_id)
    on delete set null,

  -- (id, workspace_id) unique — so that P3.2 child tables (ticket events / comments)
  -- can carry (ticket_id, workspace_id) composite FKs back to tickets, same pattern
  -- 0009 established. Additive; no data exists.
  constraint tickets_id_workspace_unique unique (id, workspace_id)
);

create index tickets_workspace_status_idx on public.tickets (workspace_id, status);
create index tickets_workspace_assigned_operator_idx on public.tickets (workspace_id, assigned_operator_id);
create index tickets_workspace_created_by_idx on public.tickets (workspace_id, created_by_user_id);
create index tickets_workspace_property_idx on public.tickets (workspace_id, property_id);

create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- TENANT-INSERT COLUMN PINNING (BEFORE INSERT trigger)
--
-- THE GAP: RLS WITH CHECK gates ROWS, not COLUMNS. The tickets_insert_own policy
-- below (correctly) lets ANY active workspace member create a ticket they own —
-- that is how a TENANT reports an issue. But a WITH CHECK cannot say "and status
-- must be NEW, and assignment columns must be NULL". So a malicious TENANT hitting
-- PostgREST directly could POST an insert with status = 'CLOSED' (hiding a real
-- issue), or assigned_operator_id / assigned_vendor_id set to someone, or a bogus
-- priority — all of which pass the row-level WITH CHECK because that check only
-- inspects workspace_id, created_by_user_id, and is_active.
--
-- THE DECISION: add a BEFORE INSERT trigger that, FOR NON-MANAGER INSERTERS, forces
-- status = 'NEW' and NULLs the assignment/scheduling/cost fields. This is chosen
-- OVER app-layer-only mitigation (P3.4 createTicket forcing safe values) because:
--   1. Tickets are the security-sensitive core of the product and TENANT/GUEST are
--      the lowest-trust roles that can write here. The app layer protects the app
--      path, but the anon/authenticated PostgREST path is directly reachable with a
--      JWT and bypasses the app entirely — leaving a real, exploitable hole.
--   2. RLS genuinely cannot pin these columns; a trigger is the correct DB-level
--      tool and is un-bypassable through PostgREST.
--   3. The spec explicitly recommends this and flags tickets as the table where it
--      matters. This is the template for the rest of Phase 3, so getting the
--      hardening right here sets the standard.
-- Managers (is_workspace_manager()) are EXEMPT: they legitimately file-and-assign in
-- one step and set status during triage. NOTE is_workspace_manager() is is_active-
-- aware (0008), so a deactivated manager is treated as a non-manager here AND is
-- separately blocked from UPDATE — belt and suspenders.
--
-- SCOPE NOTE: this trigger only sanitizes INSERT. Status transitions and assignment
-- AFTER creation are an UPDATE, which is manager-only via tickets_update_manager
-- (tenants have no UPDATE policy -> default-deny), so tenants cannot mutate status
-- post-insert either. The two together mean a tenant's ticket is born 'NEW' and
-- unassigned and stays that way until a manager acts.
--
-- The function is SECURITY DEFINER with a pinned search_path for the same reasons as
-- the 0002 helpers (it calls is_workspace_manager(), itself SECURITY DEFINER; pinning
-- search_path blocks the object-shadowing escalation vector). It is marked VOLATILE
-- (default) — a trigger that mutates NEW is not STABLE.
-- -----------------------------------------------------------------------------
create or replace function public.tickets_force_safe_insert_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_workspace_manager() then
    new.status := 'NEW';
    new.assigned_operator_id := null;
    new.assigned_vendor_id := null;
    new.scheduled_at := null;
    new.resolved_at := null;
    new.closed_at := null;
    new.estimated_cost := null;
    new.actual_cost := null;
  end if;
  return new;
end;
$$;

create trigger tickets_force_safe_insert_defaults
  before insert on public.tickets
  for each row execute function public.tickets_force_safe_insert_defaults();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003/0009/0010): a caller
-- whose current_workspace_id() is NULL matches no rows (`workspace_id = NULL` -> NULL
-- -> excluded), and current_role() is NULL only for a caller with no profile row,
-- which likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.tickets enable row level security;

-- SELECT — ROLE-DIFFERENTIATED ROWS (the new part). Two OR'd permissive policies:
-- Postgres combines multiple permissive SELECT policies with OR, so a row is visible
-- if EITHER matches. A manager/accountant matches the first; a tenant matches the
-- second on their own tickets.
--
-- Policy 1 — managers + accountant see ALL workspace tickets. Unlike properties/units/
-- vendors (which are open-select to every member), tickets are role-gated: TENANT /
-- GUEST / VENDOR are deliberately EXCLUDED from the workspace-wide view (they must not
-- see other tenants' tickets). ACCOUNTANT is INCLUDED (read-only oversight; cost
-- columns are accountant-relevant), matching a read-without-write posture. Plus the
-- SUPER_ADMIN cross-workspace platform override (SELECT only, read-only oversight).
create policy "tickets_select_manager_or_accountant"
  on public.tickets for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

-- Policy 2 — OWN tickets. Any member (in particular TENANT / GUEST / VENDOR) sees the
-- tickets THEY reported, scoped to their own workspace. created_by_user_id is the
-- reporter; auth.uid() is the caller. A manager also matches this, harmlessly (they
-- already match policy 1). This is how a tenant sees their own maintenance requests
-- without seeing anyone else's.
create policy "tickets_select_own"
  on public.tickets for select
  using (
    workspace_id = public.current_workspace_id()
    and created_by_user_id = auth.uid()
  );

-- INSERT — any ACTIVE workspace member may create a ticket THEY OWN. This is
-- deliberately NOT manager-gated: tenants reporting issues is the primary write path
-- for this table. The WITH CHECK pins:
--   * workspace_id = current_workspace_id() — no planting tickets in another workspace;
--   * created_by_user_id = auth.uid() — you can only file AS yourself (blocks forging
--     a ticket "reported by" someone else);
--   * coalesce(current_is_active(), false) — deactivated members (valid JWT, is_active
--     = false) cannot create; fails closed if the caller has no profile.
-- A manager filing on behalf of a tenant still sets created_by = themselves and puts
-- the tenant in created_for_user_id. The status/assignment columns are NOT pinnable in
-- WITH CHECK — the BEFORE INSERT trigger above sanitizes them for non-managers.
create policy "tickets_insert_own"
  on public.tickets for insert
  with check (
    workspace_id = public.current_workspace_id()
    and created_by_user_id = auth.uid()
    and coalesce(public.current_is_active(), false)
  );

-- UPDATE — managers only (SUPER_ADMIN / OWNER / OPERATOR via is_workspace_manager(),
-- which EXCLUDES ACCOUNTANT and is is_active-aware). This governs ALL post-creation
-- mutation: triage, (re)assignment, status transitions, scheduling, cost entry, and
-- the CANCELLED "soft-delete". TENANT / GUEST / VENDOR have NO update policy, so RLS
-- default-denies their updates — a tenant CANNOT touch a ticket after creating it (not
-- even their own). EXPLICIT WITH CHECK re-validates the NEW row so a workspace-hop
-- (`UPDATE ... SET workspace_id = <other>`) is rejected. No SUPER_ADMIN platform
-- override on writes (NULL workspace -> three-valued-logic rejection), same as 0003.
create policy "tickets_update_manager"
  on public.tickets for update
  using (
    workspace_id = public.current_workspace_id()
    and public.is_workspace_manager()
  )
  with check (
    workspace_id = public.current_workspace_id()
    and public.is_workspace_manager()
  );

-- No DELETE policy — intentional, same as 0003/0009/0010. RLS default-denies any
-- command without a matching policy, so DELETE is closed through the API. The
-- "delete" story for tickets is status = 'CANCELLED' (a manager UPDATE via the policy
-- above), which preserves the ticket + its future events/comments history. Rows are
-- still removed by cascade when their property / workspace is deleted.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X SELECTs
--    ALL of X's tickets (both ones they created and ones tenants created).
-- 2. A TENANT in X SELECTs ONLY tickets where created_by_user_id = their auth.uid();
--    they see ZERO tickets created by other members of X (row-level role differentiation
--    — the new guarantee this table introduces).
-- 3. A TENANT in workspace Y SELECTs ZERO of workspace X's tickets (cross-workspace
--    isolation still holds on top of the own-rows filter).
-- 4. A TENANT in X CAN INSERT a ticket with created_by_user_id = their own auth.uid()
--    and a valid X property_id (this is issue reporting; not manager-gated).
-- 5. A TENANT CANNOT UPDATE any ticket — not even one they created (no tenant UPDATE
--    policy -> default deny). Triage/assign/close is manager-only.
-- 6. A TENANT CANNOT INSERT a ticket with created_by_user_id = <someone else's id>:
--    rejected by tickets_insert_own's WITH CHECK (created_by != auth.uid()). No forging
--    a report "by" another user.
-- 7. ADVERSARIAL — TENANT insert with status = 'CLOSED' and assigned_operator_id set:
--    the row IS inserted (WITH CHECK passes) but the BEFORE INSERT trigger FORCES
--    status back to 'NEW' and NULLs the assignment/cost/schedule fields, because the
--    inserter is not a manager. The stored row is safe; the tenant cannot self-close or
--    self-assign.
-- 8. ADVERSARIAL — cross-workspace property_id rejected by the COMPOSITE FK: an insert
--    with workspace_id = X and property_id = <a property owned by Y> is REJECTED by
--    tickets_property_fk (no properties row has (Y's property id, X) as an (id,
--    workspace_id) pair) — even if RLS WITH CHECK (which only inspects workspace_id)
--    would have passed. Same for a cross-workspace unit_id / assigned_vendor_id.
-- 9. A DEACTIVATED manager in X (is_active = false) CANNOT UPDATE tickets:
--    is_workspace_manager() is is_active-aware (0008), so tickets_update_manager fails.
--    (And on INSERT they are treated as a non-manager by the trigger, so any status/
--    assignment they try to set is sanitized.)
-- 10. An ACCOUNTANT in X CAN SELECT all X tickets (policy 1 includes ACCOUNTANT) but
--     CANNOT INSERT beyond their own (they can create own via policy... actually they
--     CAN insert an own ticket like any member) and CANNOT UPDATE any ticket
--     (is_workspace_manager() excludes ACCOUNTANT) — read + own-insert, no triage.
-- 11. No user (any role) can DELETE a ticket through the API — no DELETE policy, so RLS
--     default-denies it. Cancellation is status = 'CANCELLED' via a manager UPDATE.
-- 12. Nullable-composite-FK: a ticket with unit_id = NULL (property-level, no unit)
--     inserts fine (MATCH SIMPLE skips the unit FK when unit_id is NULL); a ticket with
--     a non-NULL unit_id belonging to another workspace is rejected by tickets_unit_fk.
-- =============================================================================
