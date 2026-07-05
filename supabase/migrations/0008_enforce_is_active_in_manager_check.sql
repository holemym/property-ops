-- 0008: fold is_active into is_workspace_manager().
--
-- WHY: profiles.is_active = false is meant to revoke access (see 0007 and the
-- requireUser check in src/lib/auth/session.ts), but is_workspace_manager()
-- (0002) checks role only. Because deactivation does not (yet) ban the user's
-- Supabase Auth session, a deactivated OWNER/OPERATOR still holds a valid JWT
-- and could keep writing workspace data (e.g. properties) straight through
-- PostgREST. Replacing the function body here retro-actively hardens every
-- policy that calls it -- 0003's properties policies and all future domain
-- tables that copy the pattern -- without touching the policies themselves.
--
-- WHY THIS LIVES IN 0008 (not 0003): current_is_active() is defined in 0007;
-- policy/function bodies referencing it can only be created after 0007 in
-- lexical apply order.
--
-- NOTE: SELECT policies do not call this function, so a deactivated user can
-- still READ own-workspace rows via PostgREST until the auth-layer ban
-- (ban_duration) follow-up lands; app pages are already blocked by requireUser.
-- Write access is the sharper edge and is closed here.

create or replace function public.is_workspace_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR')
     and coalesce(public.current_is_active(), false)
$$;

-- Same treatment for can_manage_users() (0002): a deactivated OWNER/SUPER_ADMIN
-- must not keep managing profiles (re-role / deactivate co-workers) via PostgREST.
-- The `coalesce(..., false)` fails closed if current_is_active() is NULL (no profile).
create or replace function public.can_manage_users()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('SUPER_ADMIN', 'OWNER')
     and coalesce(public.current_is_active(), false)
$$;

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. An ACTIVE OPERATOR (is_active = true) can still INSERT and UPDATE properties
--    in their own workspace (is_workspace_manager() still returns true).
-- 2. After `UPDATE profiles SET is_active = false` on that OPERATOR (applied by a
--    manager, since self-deactivation is pinned per 0007), the SAME insert/update
--    statements are now REJECTED — is_workspace_manager() returns false, so the
--    properties WITH CHECK / USING fails. (Their still-valid JWT no longer buys
--    write access.)
-- 3. Reactivating (`is_active = true`) restores write access — is_workspace_manager()
--    returns true again with no further change.
-- 4. can_manage_users(): a DEACTIVATED OWNER can no longer UPDATE a co-worker's
--    profile row (profiles_update_by_manager, which calls can_manage_users(), now
--    fails); reactivating restores it.
-- =============================================================================
