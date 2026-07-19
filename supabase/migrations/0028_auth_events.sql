-- =============================================================================
-- Migration 0028: Auth audit trail (Track S2.2) + Row Level Security
-- =============================================================================
-- Adds `public.auth_events` — an append-only security audit log for
-- authentication-adjacent actions: login/signup/sign-out, password changes,
-- MFA challenge outcomes, and the two admin-on-behalf-of-another-user actions
-- (invite, deactivation). Written by src/lib/audit/log-auth-event.ts
-- (`logAuthEvent`), called from src/app/(auth)/actions.ts,
-- src/app/(app)/settings/users/actions.ts, and (via a dedicated server action)
-- src/components/auth/MfaChallenge.tsx. See
-- docs/superpowers/specs/2026-07-09-property-ops-security-hardening-design.md
-- §S2.2.
--
-- SPEC vs IMPLEMENTATION — event list: the spec's §S2.2 prose names
-- login_success/login_failure/deactivation/invite/password_change. This
-- migration's enum is a strict SUPERSET adding signup_success, sign_out, and
-- mfa_challenge_success/mfa_challenge_failure — the MFA challenge flow
-- (S2-1b) didn't exist when S2.2 was specced (2026-07-09, before the 2026-07-12
-- MFA design), and sign-out/signup are natural completions of the same
-- "auth-adjacent actions" story the spec is telling. Flagged for the S2-2
-- board entry's write-up; not a deviation from the spec's INTENT, just a
-- broader instance of it.
--
-- THE #1 CORRECTNESS PROPERTY (read this before touching the writer): a write
-- to this table must NEVER block, delay meaningfully, or error a login/
-- signup/sign-out/password-change/invite/deactivation/MFA-challenge action.
-- This migration hasn't shipped to production yet (0022-0028 are one
-- unapplied batch as of this writing), so `auth_events` DOES NOT EXIST in
-- prod today — every call site must degrade to a no-op, not a 500, until a
-- human runs this file. That correctness property lives entirely in the app
-- layer (src/lib/audit/log-auth-event.ts's try/catch), not here; this
-- migration only has to make the WRITE PATH itself narrow (service-role-only,
-- zero INSERT policy) so a best-effort service-role insert is exactly what
-- can legitimately succeed.
--
-- -----------------------------------------------------------------------------
-- ACTOR COLUMN CONVENTION: `actor_user_id` is a PLAIN FK to profiles(id), NOT
-- the composite (child_id, workspace_id) pattern roadmap v2 §2 requires for a
-- workspace-scoped table referencing ANOTHER workspace-scoped table. This
-- mirrors the established, already-reasoned precedent for every *_user_id
-- attribution column in this schema: ticket_events.actor_user_id (0012) and
-- notifications.recipient_user_id (0026) are both plain FKs, because (a) the
-- composite pattern exists to stop a cross-tenant FK-bypasses-RLS attack where
-- a child ENTITY row (a ticket, a tenancy) points at a DIFFERENT workspace's
-- parent entity — not applicable to a single actor-attribution column — and
-- (b) the actor may legitimately be a platform SUPER_ADMIN, whose
-- profiles.workspace_id is NULL; a composite FK would reject that row. The
-- table's own workspace_id column (below) is what pins the EVENT itself to a
-- workspace; actor_user_id is "which human", not "which workspace".
--
-- `actor_user_id` uses ON DELETE SET NULL (a deliberate departure from
-- ticket_events' plain, no-clause FK): an audit log's purpose is to outlive
-- the identities it references, not cascade away with them or block their
-- deletion. `workspace_id` uses ON DELETE CASCADE, matching every other
-- workspace-scoped table (0002 onward) — a deleted workspace's audit trail is
-- not independently retained in v1.
--
-- `workspace_id` is NULLABLE ("workspace-scoped where known" per spec): a
-- LOGIN_FAILURE against an email with no matching account never resolves to a
-- workspace at all. `email` is likewise a best-effort text column, not an FK
-- — it is the human-readable SUBJECT of the event (the attempted address for
-- LOGIN_FAILURE, the invited address for INVITE_SENT, the deactivated user's
-- address for DEACTIVATION, self for every other event type), independent of
-- whether actor_user_id could be resolved.
--
-- `metadata_json` (nullable jsonb) mirrors ticket_events' metadata_json
-- (0012): free-form context that doesn't warrant its own column. Used today
-- for exactly one thing — DEACTIVATION's `{"target_user_id": "..."}`, since
-- actor_user_id on that row is the ADMIN who deactivated someone, not the
-- person deactivated.
--
-- -----------------------------------------------------------------------------
-- RLS — READ CAREFULLY, FLAGGED FOR prop-rls-reviewer:
-- -----------------------------------------------------------------------------
-- INSERT: ZERO POLICY — same lock as vendor_job_tokens (0014), rate_limit_buckets
-- (0022), and notifications (0026). No `create policy ... for insert` statement
-- means default-DENY for BOTH `anon` AND `authenticated`; the only principal
-- that can write this table is `service_role` (bypasses RLS entirely),
-- exclusively via src/lib/audit/log-auth-event.ts's service-role client
-- (SUPABASE_SERVICE_ROLE_KEY is server-only, never NEXT_PUBLIC). DO NOT add an
-- INSERT policy for `authenticated` — nothing in the app should ever let a
-- user forge their own audit trail entry.
--
-- SELECT: admin-only, narrower than "manager". The spec's prose says "SELECT
-- manager-only", but this migration gates on `can_manage_users()` (0002/0008:
-- role IN ('SUPER_ADMIN','OWNER') AND is_active) rather than
-- `is_workspace_manager()` (which also admits OPERATOR). Reasoning: the S2-2
-- board task explicitly directs mirroring how /settings/users gates its own
-- admin surface (`users:invite` permission — SUPER_ADMIN/OWNER only per
-- src/lib/auth/permissions.ts's ADMIN_PERMISSIONS, never granted to OPERATOR),
-- and can_manage_users() is the RLS helper already wired to that exact
-- permission tier (profiles_update_by_manager, 0002). A security audit trail
-- of login/logout/password/MFA events is more sensitive than the
-- properties/tickets/vendors data OPERATOR already manages day-to-day, so the
-- narrower admin-only reveal here is the deliberate, defensible reading of
-- "manager-only" — treated as a spec ambiguity resolved in the stricter
-- direction, not a deviation from its intent. SUPER_ADMIN additionally keeps
-- its usual platform-wide read override (see workspaces_select_own, 0002;
-- tenants_select_manager_or_accountant, 0025) — this ALSO covers workspace_id
-- IS NULL rows (unresolvable LOGIN_FAILURE attempts), which the
-- workspace-scoped OWNER/SUPER_ADMIN clause below cannot see (workspace_id =
-- current_workspace_id() is NULL -> NULL -> excluded, correctly fails closed
-- for a workspace admin who has no way to know which workspace a stranger's
-- bad login attempt "belongs" to).
--
-- UPDATE / DELETE: none, on top of BOTH RLS default-deny (no policies for any
-- role) AND a hard BEFORE UPDATE OR DELETE trigger (auth_events_no_mutation,
-- mirroring ticket_events_no_mutation from 0012) that raises unconditionally
-- for every role including service_role/definer paths that bypass RLS.
-- Belt-and-suspenders: RLS blocks the untrusted API path; the trigger blocks
-- even a trusted/elevated path (a buggy admin script, a future SECURITY
-- DEFINER helper) from silently rewriting the audit log after the fact.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created
-- (the 0001/0002 lesson: PostgREST auto-exposes every public table the instant
-- it exists, so a table that lives even briefly without RLS is a cross-tenant
-- hole).
--
-- DEMO WORKSPACE: not wiped by reset_demo_workspace() and not extended here.
-- Unlike notifications (0026), which added a demo-wipe line because ticket
-- actions fire in the demo workspace routinely, auth_events writes are
-- App-side gated to SKIP the demo workspace entirely (isDemoWorkspace() guard
-- in the writer, mirroring notify-inapp.ts's D4 gate) — demo visitors use
-- anonymous Supabase sessions (signInAnonymously), never
-- signInWithPassword/signUp, so LOGIN_*/SIGNUP_SUCCESS never fire for them in
-- practice; a stray SIGN_OUT is harmless, low-volume, and not worth extending
-- the already-risky reset_demo_workspace() re-paste for (see 0025/0026's own
-- comments on that risk). Same precedent as profiles, which
-- reset_demo_workspace() has never touched either.
--
-- MIGRATION NUMBERING: existing files run 0001-0027. Next free lexical number
-- is 0028.
-- =============================================================================

create type public.auth_event_type as enum (
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'SIGNUP_SUCCESS',
  'SIGN_OUT',
  'PASSWORD_CHANGE',
  'INVITE_SENT',
  'DEACTIVATION',
  'MFA_CHALLENGE_SUCCESS',
  'MFA_CHALLENGE_FAILURE'
);

create table if not exists public.auth_events (
  id uuid primary key default gen_random_uuid(),

  -- Nullable: "workspace-scoped where known" (spec §S2.2) — see header.
  workspace_id uuid references public.workspaces (id) on delete cascade,

  -- Nullable, ON DELETE SET NULL: see header's ACTOR COLUMN CONVENTION note.
  actor_user_id uuid references public.profiles (id) on delete set null,

  event_type public.auth_event_type not null,

  -- The human-readable SUBJECT of the event — see header. Not an FK (may
  -- reference an address with no matching account, e.g. a bad LOGIN_FAILURE).
  email text,

  ip text,
  user_agent text,

  -- Free-form context (see header) — currently only DEACTIVATION's
  -- {"target_user_id": "..."}.
  metadata_json jsonb,

  -- created_at only — NO updated_at. Events are IMMUTABLE (see the
  -- append-only trigger below); there is no "last modified" concept.
  created_at timestamptz not null default now()
);

-- Leads with workspace_id + created_at to match the admin table's read
-- pattern (listRecentAuthEvents: newest-first, scoped to one workspace).
create index if not exists auth_events_workspace_created_idx
  on public.auth_events (workspace_id, created_at desc);

-- -----------------------------------------------------------------------------
-- APPEND-ONLY ENFORCEMENT — mirrors ticket_events_prevent_mutation (0012)
-- exactly. RLS (no update/delete policy for any normal role) closes the API
-- path; this trigger additionally hard-stops UPDATE/DELETE for every role,
-- including a service-role connection or a future SECURITY DEFINER helper
-- that would otherwise bypass RLS. INSERTs are unaffected (the trigger only
-- fires on UPDATE/DELETE).
-- -----------------------------------------------------------------------------
create or replace function public.auth_events_prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'auth_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger auth_events_no_mutation
  before update or delete on public.auth_events
  for each row execute function public.auth_events_prevent_mutation();

alter table public.auth_events enable row level security;

-- SELECT: admin-only (can_manage_users() — SUPER_ADMIN/OWNER, active), own
-- workspace; PLUS a SUPER_ADMIN platform-wide override (also covers
-- workspace_id IS NULL rows). See header for the "manager-only" -> admin-only
-- reasoning.
create policy "auth_events_select_admin"
  on public.auth_events for select
  using (
    (workspace_id = public.current_workspace_id() and public.can_manage_users())
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT: ZERO POLICY — intentional, service_role-only. See header.

-- No UPDATE/DELETE policy — intentional; RLS default-denies both, reinforced
-- by the auth_events_no_mutation trigger above.

-- =============================================================================
-- SMOKE TESTS — run these manually once applied to a live Supabase project:
-- =============================================================================
-- 1. OWNER/SUPER_ADMIN of workspace X SELECTs auth_events rows for workspace
--    X; an OPERATOR or ACCOUNTANT in the SAME workspace SELECTs ZERO rows
--    (can_manage_users() excludes both).
-- 2. A user in workspace Y SELECTs ZERO of workspace X's auth_events, even as
--    OWNER of Y.
-- 3. A row with workspace_id IS NULL (an unresolvable LOGIN_FAILURE) is
--    invisible to every workspace OWNER/SUPER_ADMIN-of-a-workspace query
--    (workspace_id = current_workspace_id() -> NULL -> excluded) but visible
--    to a platform SUPER_ADMIN via the unconditional `current_role() =
--    'SUPER_ADMIN'` clause.
-- 4. NOT INSERTABLE BY AUTHENTICATED: a logged-in user (any role, including
--    OWNER) attempting `insert into auth_events (...)` via PostgREST is
--    rejected — zero INSERT policy, default-deny.
-- 5. NOT INSERTABLE BY ANON: same as #4 for an anonymous caller.
-- 6. NOT UPDATABLE / NOT DELETABLE by ANY role, including service_role/
--    postgres directly (`update auth_events set email = 'x'` raises
--    `auth_events is append-only: UPDATE is not permitted`) — the trigger,
--    not RLS, is what stops a superuser/service-role connection.
-- 7. `select public.check_rate_limit is unaffected` — sanity check that this
--    migration didn't touch any prior helper's grants (it defines no new
--    SECURITY DEFINER function; can_manage_users()/current_workspace_id()/
--    current_role() are reused as-is from 0002/0008, already
--    authenticated-executable).
-- =============================================================================
