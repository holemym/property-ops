-- =============================================================================
-- Migration 0029: Tenant portal link (`tenants.auth_user_id`) + own-row RLS
-- =============================================================================
-- Closes the P1A gap flagged in docs/superpowers/plans/2026-07-19-product-
-- deepening.md §3: the tenant directory (`public.tenants`, migration 0025) is a
-- CONTACT record with no connection to a real Supabase Auth account, so no
-- resident could ever reach `/portal` for real. This migration adds the link
-- column + its own-row RLS; the "Invite to portal" action that WRITES it lives
-- in src/app/(app)/settings/users/actions.ts (`inviteTenantToPortal`, extending
-- the existing `inviteUser`/create-or-attach machinery from c019f72 rather than
-- duplicating it). Portal READ surfaces that consume this link are out of scope
-- here (Phase 1B) — this migration is schema-only.
--
-- MIGRATION NUMBERING: existing files run 0001-0028. Next free lexical number
-- is 0029.
--
-- -----------------------------------------------------------------------------
-- THE LINK
-- -----------------------------------------------------------------------------
-- `auth_user_id` is a plain FK to `auth.users(id)`, NOT the composite
-- (child_id, workspace_id) pattern roadmap v2 §2 requires for a workspace-scoped
-- table referencing ANOTHER WORKSPACE-SCOPED table — auth.users is Supabase's
-- global identity table, not workspace-scoped, so the composite pattern doesn't
-- apply. Same precedent as profiles.id itself (0001: `references auth.users
-- (id) on delete cascade`) and auth_events.actor_user_id (0028: plain FK to
-- profiles, for the analogous reason). `on delete set null` (not cascade): if
-- the auth account is ever deleted, the directory CONTACT record survives
-- (tenants has no DELETE policy at all — 0025 — because entries are
-- history-bearing), it just reverts to "not yet invited" rather than vanishing.
--
-- `tenants_auth_user_unique` is a PARTIAL unique index on
-- (workspace_id, auth_user_id) WHERE auth_user_id IS NOT NULL: prevents two
-- tenant directory rows in the SAME workspace from both claiming the same auth
-- account (the "which person am I" ambiguity a portal read-surface would
-- otherwise have to resolve). Scoped to workspace_id, not global, deliberately
-- — the same real person could in principle be a tenant contact in two
-- different property-ops workspaces (two unrelated landlords), which is not a
-- conflict.
--
-- -----------------------------------------------------------------------------
-- RLS — READ CAREFULLY, FLAGGED FOR prop-rls-reviewer
-- -----------------------------------------------------------------------------
-- ADDITIVE ONLY. The three existing 0025 policies (tenants_select_manager_or_
-- accountant, tenants_insert_manager, tenants_update_manager) are NOT touched —
-- byte-for-byte unchanged, still the only INSERT/UPDATE path (manager-only), no
-- DELETE. This migration adds exactly ONE new policy: a tenant may SELECT their
-- own directory row.
--
-- DEVIATION FROM THE LITERAL TASK TEXT, FLAGGED FOR VISIBILITY: the task
-- describes this policy's body as `using (auth_user_id = auth.uid())` alone.
-- Implemented here with an ADDED workspace_id conjunct instead:
--   using (auth_user_id = auth.uid() and workspace_id = current_workspace_id())
-- Reasoning: `auth_user_id = auth.uid()` alone is not workspace-scoped, and
-- every OTHER policy in this schema (tenants_select_manager_or_accountant
-- itself, tickets_select_own, notifications_select_own, auth_events_select_
-- admin, ...) always conjoins workspace_id = current_workspace_id() precisely
-- to prevent a stale cross-workspace read. Concretely: if a tenant's
-- `profiles.workspace_id` is later moved to a DIFFERENT workspace (the exact
-- "re-invite an existing account" path `inviteOrAttachUser`/`findUserIdByEmail`
-- already implements for staff, and which nothing stops from being re-run
-- against a tenant email later) while an OLD workspace's `tenants` row still
-- carries that same `auth_user_id` (nothing unlinks it), the literal
-- `auth_user_id = auth.uid()` policy would let that person keep reading the
-- OLD workspace's tenant contact row (full_name/email/phone/notes) — a
-- cross-workspace PII leak — even though they are no longer a member there.
-- Adding the workspace_id conjunct costs nothing in the intended case (the link
-- is always created in the tenant's own current workspace) and closes that
-- gap. Flagged for prop-rls-reviewer + the orchestrator rather than silently
-- diverging: this is the kind of "spec sentence proven wrong on inspection"
-- roadmap v2 asks builders to fix rather than duplicate.
--
-- No tenant WRITE policy of any kind (INSERT/UPDATE/DELETE) — a tenant can
-- never edit their own directory contact record via the API. Still
-- manager-only, unchanged from 0025.
--
-- DEMO WORKSPACE: not touched. reset_demo_workspace() (0023, extended by 0025)
-- already wipes every demo-workspace `tenants` row wholesale on each reset;
-- none of the seeded demo tenants carry an auth_user_id (no seed inserts it),
-- so there is nothing new for the reset function to additionally clean up.
-- =============================================================================

alter table public.tenants
  add column if not exists auth_user_id uuid references auth.users (id) on delete set null;

create unique index if not exists tenants_auth_user_unique
  on public.tenants (workspace_id, auth_user_id)
  where auth_user_id is not null;

-- SELECT: a tenant reads ONLY their own directory row. See the RLS section
-- above for why this conjoins workspace_id = current_workspace_id() beyond the
-- task's literal `auth_user_id = auth.uid()` text.
create policy "tenants_select_own"
  on public.tenants for select
  using (
    auth_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
  );

-- =============================================================================
-- SMOKE TESTS — run these manually once applied to a live Supabase project:
-- =============================================================================
-- 1. A TENANT whose profiles row and linked tenants row are BOTH in workspace X
--    SELECTs exactly their own tenants row (auth_user_id = their uid, workspace
--    match) — no other row.
-- 2. That same TENANT SELECTs ZERO of any OTHER tenant's row in X (auth_user_id
--    does not match their uid).
-- 3. ADVERSARIAL / the deviation this migration guards against: a tenant whose
--    profiles.workspace_id has been moved to workspace Y (re-invited elsewhere)
--    SELECTs ZERO rows from workspace X's tenants table, even though an old,
--    unlinked X row still carries their auth_user_id — the workspace_id
--    conjunct excludes it (current_workspace_id() now resolves to Y, not X).
-- 4. A TENANT with no linked tenants row anywhere (auth_user_id never set on
--    any row) SELECTs zero rows via this new policy (existing manager/
--    accountant-only policy still excludes them too, per 0025 — unaffected).
-- 5. Managers/accountant SELECT behaviour is completely unchanged (0025's
--    policy untouched) — an OPERATOR/OWNER/SUPER_ADMIN/ACCOUNTANT in X still
--    sees every tenants row in X regardless of auth_user_id.
-- 6. A TENANT still CANNOT INSERT, UPDATE, or DELETE any tenants row (no
--    policy grants it — 0025's manager-only write policies are untouched, and
--    this migration adds no write policy of its own).
-- 7. tenants_auth_user_unique: inserting/linking a SECOND tenants row in the
--    SAME workspace to an auth_user_id already linked to another row in that
--    workspace is REJECTED by the partial unique index.
-- 8. The SAME auth_user_id CAN be linked to tenants rows in two DIFFERENT
--    workspaces (partial unique index is scoped by workspace_id) — not a
--    conflict, per the header rationale.
-- =============================================================================
