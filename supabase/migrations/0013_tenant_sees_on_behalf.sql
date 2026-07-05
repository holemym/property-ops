-- =============================================================================
-- Migration 0013: Widen tickets_select_own so tenants see ON-BEHALF-OF tickets
-- =============================================================================
-- Closes the P3.1 deferred UX obligation flagged in 0011. The original
-- `tickets_select_own` policy (0011) matches ONLY `created_by_user_id = auth.uid()`,
-- i.e. tickets the caller filed THEMSELVES. But a ticket a MANAGER files ON BEHALF OF
-- a tenant sets created_by = the manager and created_for_user_id = the tenant — so
-- under the 0011 policy that ticket is INVISIBLE to the tenant it concerns. When the
-- P3.7 tenant portal lists "My Requests" (via listTickets, which is RLS-scoped), an
-- on-behalf ticket the tenant phoned in would silently not appear.
--
-- THE FIX (spec option (a)): DROP and recreate `tickets_select_own` to ALSO match
-- `created_for_user_id = auth.uid()`. A tenant now sees a ticket if they are EITHER
-- the reporter (created_by) OR the subject a manager filed it for (created_for).
--
-- WHY DROP-AND-RECREATE rather than a second OR'd policy: Postgres OR's multiple
-- permissive SELECT policies, so adding a THIRD policy would also work — but keeping
-- the "own tickets" rule as ONE named policy (whose body is a single OR of the two
-- ownership columns) keeps the tenant-visibility contract in one readable place, and
-- mirrors 0011's own style (a single `tickets_select_own` policy). We recreate rather
-- than ALTER because Postgres has no `ALTER POLICY ... USING` that reads cleanly here;
-- drop+create is the idiomatic migration for a policy body change.
--
-- SCOPE / NON-OVER-WIDENING (the security-sensitive part):
--   * The `workspace_id = current_workspace_id()` conjunct is PRESERVED — the policy
--     is still workspace-scoped; a tenant can never see another workspace's tickets.
--   * The match is still OWN-ROWS ONLY: created_by OR created_for equal to auth.uid().
--     A tenant still cannot see a ticket where they are NEITHER the reporter NOR the
--     subject. In particular they still see ZERO of another tenant's tickets.
--   * created_for_user_id is a plain FK to profiles(id); it is set by a MANAGER on the
--     create-on-behalf path (P3.6 validates the target is a workspace member via
--     getWorkspaceProfile before setting it), so a tenant cannot inflate their own
--     visibility by planting created_for = themselves — they have no UPDATE policy on
--     tickets (0011: no tenant update) and the INSERT trigger + WITH CHECK govern what
--     they may create (created_by = auth.uid(); a tenant setting created_for on their
--     OWN insert only ever names themselves anyway, which is harmless).
--   * NULL-safety unchanged: current_workspace_id() NULL -> no rows; auth.uid() is
--     never NULL for an authenticated caller, and `col = auth.uid()` is NULL (excluded)
--     when the column is NULL, so a NULL created_for simply doesn't match — fail-closed.
--
-- The manager/accountant SELECT policy (tickets_select_manager_or_accountant) is
-- UNCHANGED — managers already see every workspace ticket, on-behalf or not.
--
-- MIGRATION NUMBERING: existing files are 0001..0012. Next free lexical number, 0013.
-- Additive/idempotent-safe on empty data. `drop policy if exists` guards a re-run.
-- =============================================================================

drop policy if exists "tickets_select_own" on public.tickets;

-- OWN tickets — any member (in particular TENANT / GUEST / VENDOR) sees a ticket they
-- are involved in AS AN OWNER, scoped to their own workspace. "Owner" now means EITHER
-- the reporter (created_by_user_id, the original 0011 match) OR the subject a manager
-- filed it for (created_for_user_id, the on-behalf case this migration adds). A manager
-- also matches this harmlessly (they already match tickets_select_manager_or_accountant).
create policy "tickets_select_own"
  on public.tickets for select
  using (
    workspace_id = public.current_workspace_id()
    and (
      created_by_user_id = auth.uid()
      or created_for_user_id = auth.uid()
    )
  );

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A TENANT who REPORTED ticket T (created_by = them, created_for = NULL) still
--    SELECTs T (the original 0011 guarantee is preserved).
-- 2. A TENANT for whom a MANAGER filed ticket U on behalf (created_by = the manager,
--    created_for = the tenant) NOW SELECTs U — previously invisible under 0011. This is
--    the P3.1 defer this migration closes.
-- 3. A TENANT still SELECTs ZERO of another tenant's tickets (created_by = other,
--    created_for = other-or-NULL): neither ownership column equals their auth.uid(), so
--    the policy does not match — no over-widening.
-- 4. A TENANT in workspace Y still SELECTs ZERO of workspace X's tickets: the preserved
--    workspace_id conjunct rejects cross-workspace rows even if (impossibly) an id
--    matched. Workspace isolation holds on top of the own-rows filter.
-- 5. A MANAGER/ACCOUNTANT in X still SELECTs ALL of X's tickets (unchanged — that is a
--    different policy, tickets_select_manager_or_accountant, untouched here).
-- =============================================================================
