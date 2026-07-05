-- =============================================================================
-- Migration 0007: Pin is_active in profiles_update_self (self-reactivation fix)
-- =============================================================================
-- WHY: A code review found that migration 0002's `profiles_update_self` policy
-- pinned `role` and `workspace_id` in its WITH CHECK, but NOT `is_active`. Because
-- RLS gates rows and not columns, an unpinned column is fully self-editable. That
-- means a DEACTIVATED user (is_active = false) could run, straight through the
-- PostgREST API from the client:
--
--     supabase.from('profiles').update({ is_active: true }).eq('id', auth.uid())
--
-- ...and silently self-REACTIVATE — the post-update row still satisfies
-- `id = auth.uid()`, so the old WITH CHECK accepted it. Migration 0002's own inline
-- comment even described `is_active-on-self` as freely editable; that was the bug.
-- Only a manager (SUPER_ADMIN / OWNER, via profiles_update_by_manager) is supposed
-- to change is_active.
--
-- FIX: Add a SECURITY DEFINER helper `current_is_active()` that reads the caller's
-- CURRENTLY-STORED is_active (mirroring current_role() / current_workspace_id() in
-- 0002 — same reason they are SECURITY DEFINER + pinned search_path: they read
-- public.profiles, which has RLS enabled, and are called from inside profiles' own
-- policy, so a SECURITY INVOKER function would recurse into profiles_* policies).
-- Then drop and recreate profiles_update_self with `is_active` ALSO pinned via
-- `is not distinct from`, exactly like role / workspace_id.
--
-- This is an ALTER-by-recreate: migrations are immutable, so we do NOT edit 0002;
-- we DROP the old policy and CREATE the corrected one here.
--
-- WHAT STILL WORKS: pinning only forces the post-update value to EQUAL the stored
-- value. A user editing full_name / phone / avatar_url leaves is_active untouched,
-- so `is_active is not distinct from public.current_is_active()` is trivially true
-- and the update is accepted. Only an attempt to CHANGE one's own is_active is
-- rejected. Managers are unaffected (they use profiles_update_by_manager, a
-- separate policy that is not touched here).
-- =============================================================================

-- New helper — mirrors current_role() / current_workspace_id() from 0002 exactly:
-- language sql, STABLE, SECURITY DEFINER, pinned search_path. Reads the caller's
-- own currently-stored is_active. SECURITY DEFINER bypasses RLS on this internal
-- read (breaking the policy-recursion cycle); the pinned search_path blocks the
-- classic SECURITY DEFINER object-shadowing escalation vector. Do NOT remove.
create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_active from public.profiles where id = auth.uid()
$$;

-- Recreate profiles_update_self with is_active pinned alongside role/workspace_id.
-- USING is unchanged (a user may only target their own row). WITH CHECK now rejects
-- any post-update row whose role, workspace_id, OR is_active differs from the
-- caller's stored values — blocking self-promotion, self-workspace-hop, AND
-- self-reactivation, while still allowing full_name/phone/avatar_url self-edits.
-- `is not distinct from` (not `=`) is used so NULL-vs-NULL compares equal, keeping
-- NULL-workspace users able to edit their own name (matching 0002's rationale).
drop policy if exists "profiles_update_self" on public.profiles;

create policy "profiles_update_self"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role is not distinct from public.current_role()
    and workspace_id is not distinct from public.current_workspace_id()
    and is_active is not distinct from public.current_is_active()
  );

-- =============================================================================
-- SMOKE TESTS — run manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A DEACTIVATED user (is_active = false) running
--    `UPDATE profiles SET is_active = true WHERE id = auth.uid()` is REJECTED by
--    RLS (0 rows / policy violation) — no self-reactivation.
-- 2. Any user can still `UPDATE profiles SET full_name = 'X' WHERE id = auth.uid()`
--    (and phone / avatar_url) on their own row — is_active is unchanged, so the pin
--    passes.
-- 3. An OWNER / SUPER_ADMIN can still deactivate/reactivate a co-worker in their
--    own workspace (unaffected — that path uses profiles_update_by_manager).
-- 4. Re-verify 0002's cases 3 & 4 still hold: role / workspace_id self-change is
--    still rejected.
-- =============================================================================
