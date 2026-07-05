-- =============================================================================
-- Migration 0003: Properties (portfolio) + Row Level Security
-- =============================================================================
-- Adds the first Phase 2 domain table, `public.properties`, plus its two
-- supporting enums (property_type, entity_status). This is the TEMPLATE that the
-- future units and vendors migrations copy, so it is deliberately explicit.
--
-- COPIER GUIDANCE: "units" and "vendors" are plan TASK numbers (0018 / 0021 in the
-- plan text), NOT migration filenames. The actual migration files land AFTER 0008
-- in lexical apply order (the next free numbers, e.g. 0009 / 0010) — number them
-- by their apply position, not by the plan task id.
--
-- SHARED TYPE WARNING: `public.entity_status` (defined below) is a SHARED enum used
-- by properties, units, vendors, and every other Phase 2/3 domain table. It is
-- created HERE, once. Do NOT re-create it in the units/vendors migrations — a naive
-- copy of this file that leaves the `create type public.entity_status ...` line in
-- will fail loudly on apply ("type already exists"), which is the correct, fail-fast
-- outcome; just delete that line from the copy and REUSE the existing type. The
-- per-table `property_type` enum, by contrast, is table-specific — units/vendors get
-- their own analogous enum if they need one.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created — not
-- split into a later migration. This is the hard-learned lesson from 0001/0002:
-- Supabase auto-exposes every public-schema table via PostgREST the instant it
-- exists, so a table that lives even briefly without RLS is a cross-tenant read/
-- write hole. Fail closed from the moment the table exists (see 0001's warning).
--
-- All helper functions used below (set_updated_at, current_workspace_id,
-- current_role, is_workspace_manager) already exist from 0001/0002 and are REUSED
-- here — they are NOT redefined. Lexical apply order is 0001 -> 0002 -> 0003 ->
-- 0006 -> 0007 -> 0008, so every dependency this file needs is already in place, and
-- nothing in 0006/0007 (which only touch workspaces/profiles) conflicts with 0003
-- being applied between 0002 and 0006.
--
-- NOTE: 0008 later re-defines is_workspace_manager() (via create or replace) to also
-- require the caller be is_active. The policies below reference the function by name
-- and evaluate its CURRENT body per query, so once 0008 applies, a deactivated
-- manager is blocked from these INSERT/UPDATE policies with no change to this file.
-- =============================================================================

create type public.property_type as enum (
  'APARTMENT_BUILDING',
  'SINGLE_APARTMENT',
  'MIXED_USE',
  'OFFICE',
  'OTHER'
);

create type public.entity_status as enum ('ACTIVE', 'ARCHIVED');

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  postal_code text not null,
  country text not null,
  property_type public.property_type not null default 'OTHER',
  -- `notes`: WORKSPACE-VISIBLE free text. Under the open-select design below
  -- (properties_select_workspace gates on membership, NOT role), this column is
  -- readable by TENANT / GUEST / VENDOR sessions hitting PostgREST directly. Do NOT
  -- put internal-only remarks here — no door codes, owner phone numbers, or tenant
  -- assessments. When Phase 3 needs manager-private remarks, add a SEPARATE
  -- structure (e.g. an `internal_notes` column or table with its own manager-only
  -- RLS), rather than silently widening this column's audience assumptions. The
  -- future units migration's free-text fields inherit the same rule: workspace-wide
  -- readable, so internal remarks go in a separate manager-gated place.
  notes text,
  status public.entity_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index properties_workspace_id_idx on public.properties (workspace_id);

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002): a caller whose
-- current_workspace_id() is NULL matches no rows (`workspace_id = NULL` -> NULL ->
-- excluded), and current_role() is NULL only for a caller with no profile row,
-- which likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.properties enable row level security;

-- SELECT: gated on WORKSPACE MEMBERSHIP ONLY (plus the SUPER_ADMIN platform
-- override), NOT on role. This is a deliberate, load-bearing design decision —
-- documented here so future reviewers don't re-litigate it:
--
-- The app-level permission matrix (src/lib/auth/permissions.ts) grants
-- `properties:read` to SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT and withholds
-- it from TENANT / GUEST / VENDOR. That matrix is the ROLE-UX boundary: the
-- portfolio pages call requirePermission('properties:read'), so a TENANT never
-- sees the property list in the app. RLS is a DIFFERENT boundary: it is the
-- TENANT-ISOLATION (multi-tenancy) boundary — its job is that workspace X's rows
-- are invisible to workspace Y, full stop.
--
-- Why not also pin role here (i.e. require is_workspace_manager()/read perm in
-- RLS)? Because tenants, guests and vendors are REAL members of the same
-- workspace, and Phase 3 (tickets) requires them to reference the property/unit a
-- ticket is raised against — e.g. a tenant submitting a maintenance request needs
-- to resolve the unit -> property it belongs to. A role-pinned SELECT policy would
-- break those legitimate cross-references (or force every such read through a
-- SECURITY DEFINER RPC, adding surface area for no isolation benefit). The
-- concrete "anon-key enumeration" worry — a TENANT hitting PostgREST directly and
-- listing properties — is bounded to THEIR OWN workspace's properties (the very
-- portfolio their units/tickets live in), which is not a cross-tenant leak and not
-- sensitive relative to what they already legitimately reference. The isolation
-- guarantee we actually care about (no visibility into OTHER workspaces) holds.
-- Finer per-role UX hiding stays at the app layer where it belongs.
create policy "properties_select_workspace"
  on public.properties for select
  using (workspace_id = public.current_workspace_id() or public.current_role() = 'SUPER_ADMIN');

-- INSERT / UPDATE: managers only (SUPER_ADMIN / OWNER / OPERATOR via
-- is_workspace_manager(), which deliberately EXCLUDES ACCOUNTANT), and only within
-- their own workspace. ACCOUNTANT gets read-only, matching properties:read-without
-- -write in the permission matrix.
--
-- SUPER_ADMIN NOTE: unlike the SELECT policy above, these WRITE policies grant NO
-- platform override. A platform SUPER_ADMIN has workspace_id = NULL, so although
-- is_workspace_manager() returns true for them, the `workspace_id = current_workspace_id()`
-- conjunct evaluates `workspace_id = NULL` -> NULL -> rejected (three-valued logic,
-- same as 0002). This is INTENTIONAL and fail-closed: SUPER_ADMIN's platform reach
-- is READ-ONLY oversight (it appears only in the SELECT policy); writing to a
-- workspace's properties requires actual membership in that workspace. A SUPER_ADMIN
-- who genuinely needs to write joins the workspace (gets a non-NULL workspace_id).
create policy "properties_insert_manager"
  on public.properties for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- Explicit WITH CHECK (not relying on the implicit default). WITH CHECK re-validates
-- the NEW row, so an `UPDATE ... SET workspace_id = <other workspace>` is rejected:
-- the post-update workspace_id would no longer equal current_workspace_id(). Postgres
-- would default WITH CHECK to the USING expression here and get the same result, but
-- an implicit load-bearing default does not survive being copied into the next domain
-- table's migration, so it is spelled out — the template teaches the safe pattern.
create policy "properties_update_manager"
  on public.properties for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — intentional. RLS default-denies any command without a
-- matching policy, so DELETE is closed to everyone through the API. Deletion is
-- modeled as archiving (status = 'ARCHIVED'), per the plan; there is no hard-delete
-- path for portfolio rows.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN) in workspace X can INSERT, UPDATE,
--    and SELECT properties belonging to X.
-- 2. Any user in workspace Y SELECTs ZERO of workspace X's properties (tenant
--    isolation — the core guarantee).
-- 3. An ACCOUNTANT in X can SELECT X's properties but CANNOT INSERT or UPDATE them
--    (is_workspace_manager() excludes ACCOUNTANT), matching properties:read without
--    properties:write.
-- 4. A TENANT / GUEST / VENDOR in X CAN SELECT X's properties at the RLS layer
--    (workspace membership only — see the select-policy comment). They are still
--    blocked from the property UI by requirePermission('properties:read') at the
--    app layer; this is by design (RLS = isolation boundary, matrix = role UX).
-- 5. No user (any role) can DELETE a property through the API — there is no DELETE
--    policy, so RLS default-denies it. Archiving is done via UPDATE status.
-- 6. A manager in workspace Y attempting `INSERT INTO properties (..., workspace_id)
--    VALUES (..., <workspace X's id>)` is REJECTED by the insert WITH CHECK (the NEW
--    row's workspace_id != current_workspace_id()) — no cross-workspace row planting.
-- 7. A manager in workspace X attempting
--    `UPDATE properties SET workspace_id = <workspace Y's id> WHERE ...` (against a
--    row they legitimately own in X) is REJECTED by the update WITH CHECK — no
--    moving a row out of one's own workspace into another. (Cases 6 & 7 are the
--    WITH-CHECK behaviors most in need of live-DB verification.)
-- =============================================================================
