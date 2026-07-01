-- =============================================================================
-- Migration 0002: Row Level Security for workspaces + profiles
-- =============================================================================
-- RLS is the ACTUAL enforcement boundary for workspace multi-tenancy in this
-- system (not merely defense-in-depth). Once this migration runs, PostgREST /
-- the Supabase anon+authenticated roles are constrained by these policies.
--
-- This file intentionally deviates from the literal Task 4 plan text in three
-- places to close genuine security holes. Each deviation is marked [DEVIATION]
-- with its reasoning inline. See the accompanying task report for the full
-- security walkthrough.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Step 1: Helper functions used by every future policy.
--
-- All three are SECURITY DEFINER with a pinned search_path. This is REQUIRED,
-- not optional:
--   * They read public.profiles, which has RLS enabled below. A plain
--     (SECURITY INVOKER) function called from inside another table's RLS policy
--     would re-enter profiles' own RLS policies -> and profiles_select_* itself
--     calls current_workspace_id(), which reads profiles -> infinite recursion
--     / "chicken-and-egg". SECURITY DEFINER makes these functions run as the
--     table owner, which bypasses RLS on the internal profiles read, breaking
--     the cycle.
--   * The pinned `set search_path = public` prevents a malicious caller from
--     shadowing `profiles` (or any referenced object) via a mutable search_path
--     -- a classic SECURITY DEFINER privilege-escalation vector. Do NOT remove.
--   * They are marked STABLE (correct: they only read, within a statement) so
--     the planner can cache them per-statement.
-- -----------------------------------------------------------------------------

create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.profiles where id = auth.uid()
$$;

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_workspace_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR')
$$;

-- [DEVIATION 1 — new helper] Dedicated helper for "can manage OTHER users'
-- profiles". Task 5's app-level permission matrix grants users:invite /
-- users:manage ONLY to SUPER_ADMIN and OWNER (NOT OPERATOR). is_workspace_manager()
-- above deliberately still includes OPERATOR because it is intended for general
-- "operational manager" gating in later, non-user-management policies (e.g.
-- properties/units). Using is_workspace_manager() for the profiles UPDATE policy
-- would let an OPERATOR deactivate / re-role co-workers straight through the API,
-- contradicting the UI which hides those controls from Operators. We therefore
-- gate profile management on a narrower helper that matches the permission matrix.
create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('SUPER_ADMIN', 'OWNER')
$$;

-- -----------------------------------------------------------------------------
-- Step 2: Enable RLS and add policies.
--
-- NULL-safety note (applies to every policy below): Postgres uses three-valued
-- logic. `x = NULL` evaluates to NULL, and a policy expression that evaluates to
-- NULL is treated as FALSE (the row is filtered OUT / the write is rejected).
-- So a brand-new user whose current_workspace_id() is NULL never accidentally
-- matches other rows: `workspace_id = NULL` -> NULL -> row excluded. Two distinct
-- NULL-workspace users likewise cannot see each other (`NULL = NULL` -> NULL).
-- current_role() can never be NULL for a user that has a profile row, because
-- profiles.role is NOT NULL with a default; a caller with no profile row at all
-- gets NULL from every helper, which again fails closed.
-- -----------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;

-- --- workspaces --------------------------------------------------------------

create policy "workspaces_select_own"
  on public.workspaces for select
  using (
    id = public.current_workspace_id()
    or public.current_role() = 'SUPER_ADMIN'
  );

-- [DEVIATION 2 — tightened WITH CHECK] The plan allowed insert for any
-- authenticated user (`auth.uid() is not null`). That lets an existing workspace
-- member spray unlimited orphan workspace rows. Task 10's flow only needs a user
-- WITHOUT a workspace to create one (self-provisioning). We therefore require the
-- caller to currently have no workspace, OR be a SUPER_ADMIN (platform admin who
-- may provision workspaces for others). This still satisfies Task 10 while
-- removing the orphan-spraying vector.
create policy "workspaces_insert_authenticated"
  on public.workspaces for insert
  with check (
    auth.uid() is not null
    and (
      public.current_workspace_id() is null
      or public.current_role() = 'SUPER_ADMIN'
    )
  );

create policy "workspaces_update_owner"
  on public.workspaces for update
  using (
    id = public.current_workspace_id()
    and public.current_role() in ('SUPER_ADMIN', 'OWNER')
  );

-- --- profiles ----------------------------------------------------------------

create policy "profiles_select_self_or_workspace"
  on public.profiles for select
  using (
    id = auth.uid()
    or workspace_id = public.current_workspace_id()
    or public.current_role() = 'SUPER_ADMIN'
  );

-- [DEVIATION 3 — added explicit WITH CHECK] The plan's profiles_update_self had
-- only a USING clause. With no explicit WITH CHECK, Postgres defaults WITH CHECK
-- to the USING expression (`id = auth.uid()`), which the row STILL satisfies
-- after `set role = 'OWNER'` or `set workspace_id = <other>`. That is a real
-- self-service privilege-escalation / workspace-hop hole: a user could promote
-- themselves or move into another workspace with a single UPDATE against the API.
--
-- RLS gates rows, not columns, so we cannot say "allow updating everything except
-- role/workspace_id" directly. Instead we pin those two columns in WITH CHECK:
-- the post-update row is only accepted if its role and workspace_id are UNCHANGED
-- from the caller's currently stored values (read via the SECURITY DEFINER
-- helpers, which is safe from recursion). This lets users freely edit their own
-- full_name/phone/avatar_url/is_active-on-self etc., but blocks self-promotion
-- and self-workspace-move at the database layer.
--
-- NOTE for later tasks: this is a defense-in-depth pin, not a substitute for the
-- application layer. The `is not distinct from` comparisons below correctly treat
-- NULL workspace_id as equal to NULL (unlike `=`), so a NULL-workspace user can
-- still update their own name without tripping the check.
create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from public.current_role()
    and workspace_id is not distinct from public.current_workspace_id()
  );

-- Managers (SUPER_ADMIN / OWNER only — see can_manage_users / DEVIATION 1) may
-- update any profile within their own workspace: re-role, deactivate, etc.
-- USING restricts the targetable rows to same-workspace profiles; WITH CHECK
-- (defaulting to USING here) prevents a manager from flinging a profile OUT of
-- their workspace into another one, since the post-update workspace_id must still
-- equal current_workspace_id().
create policy "profiles_update_by_manager"
  on public.profiles for update
  using (
    workspace_id = public.current_workspace_id()
    and public.can_manage_users()
  );
