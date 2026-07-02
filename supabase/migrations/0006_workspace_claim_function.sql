-- Fixes a real RLS gap discovered during Task 10: profiles_update_self's WITH CHECK
-- (migration 0002) intentionally blocks a user from changing their own role/workspace_id,
-- to prevent self-promotion. But Task 10's workspace-creation flow legitimately needs to
-- do exactly that (a workspace-less user creates a workspace and becomes its OWNER).
-- A naive RLS loosening (e.g. "allow role/workspace_id change whenever current
-- workspace_id is null") would let a user set workspace_id to an ARBITRARY existing
-- workspace's id and self-promote to OWNER of a workspace they don't own. Instead, this
-- SECURITY DEFINER function atomically creates the workspace and claims ownership in one
-- transaction, so the claimed workspace_id can only ever be the id of the workspace just
-- inserted by this same call -- never an arbitrary existing workspace.

create or replace function public.create_workspace_and_claim_owner(
  workspace_name text,
  workspace_currency text default 'EUR',
  workspace_language text default 'en'
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace public.workspaces;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if public.current_workspace_id() is not null then
    raise exception 'User already belongs to a workspace';
  end if;

  insert into public.workspaces (name, currency, language)
  values (workspace_name, workspace_currency, workspace_language)
  returning * into new_workspace;

  update public.profiles
  set workspace_id = new_workspace.id, role = 'OWNER'
  where id = auth.uid();

  return new_workspace;
end;
$$;

grant execute on function public.create_workspace_and_claim_owner(text, text, text) to authenticated;

-- =============================================================================
-- SMOKE TESTS -- run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A workspace-less authenticated user calling this RPC gets a new workspace back,
--    and their own profiles row now has workspace_id set to that new workspace's id
--    and role = 'OWNER'.
-- 2. A user who already belongs to a workspace calling this RPC gets an error
--    ("User already belongs to a workspace") and no new workspace is created.
-- 3. Calling profiles_update_self directly (bypassing this RPC) to set an arbitrary
--    workspace_id/role is still rejected by RLS -- confirm this RPC is the ONLY path
--    to claiming workspace ownership, the direct-update escalation path from Task 4
--    is still closed.
