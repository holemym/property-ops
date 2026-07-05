-- =============================================================================
-- Migration 0003: Properties (portfolio) + Row Level Security
-- =============================================================================
-- Adds the first Phase 2 domain table, `public.properties`, plus its two
-- supporting enums (property_type, entity_status). This is the TEMPLATE that the
-- units (0018) and vendors (0021) migrations copy, so it is deliberately explicit.
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
-- 0006 -> 0007, so every dependency this file needs is already in place, and
-- nothing in 0006/0007 (which only touch workspaces/profiles) conflicts with 0003
-- being applied between 0002 and 0006.
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
create policy "properties_write_manager"
  on public.properties for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

create policy "properties_update_manager"
  on public.properties for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

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
-- =============================================================================
