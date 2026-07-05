-- =============================================================================
-- Migration 0012: Ticket events (append-only audit log) + Ticket comments
--                 (public/internal visibility) + Row Level Security
-- =============================================================================
-- Adds the two child tables that hang off `public.tickets` (0011):
--
--   * `public.ticket_events`  — the APPEND-ONLY AUDIT LOG. Every meaningful thing
--     that happens to a ticket (created, status/priority/category changed, operator
--     /vendor assigned, comment added, attachment/invoice uploaded, AI classified,
--     expense linked, closed) is recorded here as an immutable row. Events are NEVER
--     updated or deleted in-app — the log is the tamper-evident history of the
--     ticket. This immutability is enforced TWO ways (RLS + a mutation-blocking
--     trigger); see the APPEND-ONLY ENFORCEMENT block.
--
--   * `public.ticket_comments` — the conversation/notes thread on a ticket, with a
--     PUBLIC vs INTERNAL visibility axis. PUBLIC comments are the tenant-facing
--     thread (a tenant sees them on their own ticket); INTERNAL comments are
--     staff-only side-channel notes that a tenant/guest must NEVER see, even on
--     their own ticket. This internal/public boundary is the security-sensitive
--     core of this migration and is treated with the same rigor 0011 got.
--
-- Plus four table-specific enums: actor_type, ticket_event_type,
-- comment_visibility, comment_type.
--
-- MIGRATION NUMBERING: existing files are 0001..0011. This is the next free lexical
-- number, 0012 — numbered by apply position, not by the plan task id (P3.2).
--
-- COMPOSITE-FK REUSE: 0011 added `tickets_id_workspace_unique unique (id,
-- workspace_id)` on tickets EXACTLY so these child tables can carry a (ticket_id,
-- workspace_id) composite FK back to tickets — the same FK-bypasses-RLS hardening
-- 0009 established (an FK checks row existence and ignores RLS, so a plain
-- `ticket_id references tickets(id)` would let a caller in workspace X attach an
-- event/comment to workspace Y's ticket by guessing its id; the composite pair
-- forces the child's workspace_id to equal the parent ticket's). Both child FKs use
-- REQUIRED columns (ticket_id + workspace_id are NOT NULL), so the pair is always
-- fully checked (no MATCH SIMPLE partial-NULL escape hatch here).
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role,
-- is_workspace_manager (is_active-aware since 0008), current_is_active all exist
-- from 0001/0002/0007/0008 and are REUSED. Two NEW helpers are defined below —
-- public.user_owns_ticket(uuid) and public.log_ticket_event(...) — for reasons
-- documented at each.
--
-- RLS is enabled in THIS SAME FILE, immediately after each table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists,
-- so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create type public.actor_type as enum ('USER', 'SYSTEM', 'AI', 'AUTOMATION');

create type public.ticket_event_type as enum (
  'TICKET_CREATED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'CATEGORY_CHANGED',
  'OPERATOR_ASSIGNED',
  'VENDOR_ASSIGNED',
  'COMMENT_ADDED',
  'ATTACHMENT_UPLOADED',
  'AI_CLASSIFICATION_GENERATED',
  'EXPENSE_LINKED',
  'INVOICE_UPLOADED',
  'TICKET_CLOSED'
);

create type public.comment_visibility as enum ('PUBLIC', 'INTERNAL');

create type public.comment_type as enum ('MESSAGE', 'SYSTEM_NOTE', 'AI_NOTE');

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER helper: user_owns_ticket(ticket_id)
--
-- Used by the ticket_comments tenant SELECT/INSERT policies to answer "does the
-- CALLER own (i.e. is the reporter of) this ticket?" without letting the policy's
-- subquery re-enter tickets' own RLS.
--
-- WHY A HELPER instead of an inline `ticket_id in (select id from public.tickets
-- where created_by_user_id = auth.uid())` subquery? Two reasons:
--   1. RLS-SUBQUERY SEMANTICS: a subquery embedded in an RLS policy is planned as
--      the CALLER (SECURITY INVOKER context), so it is itself subject to tickets'
--      RLS policies (tickets_select_own / tickets_select_manager_or_accountant).
--      That is not wrong per se — tickets_select_own would expose exactly the
--      caller's own ticket ids — but it makes the comment policy's correctness
--      DEPEND on another table's policy set, and it invites confusing planner
--      behavior / policy interaction as tickets' policies evolve. Isolating the
--      ownership test in a SECURITY DEFINER function makes the check SELF-CONTAINED
--      and independent of tickets' RLS.
--   2. CLEAN, EXPLICIT SEMANTICS: this helper checks ONE thing — created_by_user_id
--      = auth.uid() — regardless of how tickets' visibility rules change later. The
--      comment policy reads plainly: "PUBLIC comment on a ticket you reported".
--
-- Mirrors the 0002 helper contract: language sql, STABLE (read-only within a
-- statement), SECURITY DEFINER (runs as owner -> bypasses tickets' RLS on this
-- internal read, so there is NO recursion and no dependence on tickets' policies),
-- and a pinned `search_path = public` (blocks the classic SECURITY DEFINER
-- object-shadowing escalation vector — do NOT remove). Returns TRUE only when a
-- ticket with that id exists AND the caller is its reporter; returns FALSE (never
-- NULL) otherwise, so the policies fail closed.
-- -----------------------------------------------------------------------------
create or replace function public.user_owns_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tickets
    where id = p_ticket_id
      and created_by_user_id = auth.uid()
  )
$$;

-- =============================================================================
-- TABLE: public.ticket_events  (APPEND-ONLY AUDIT LOG)
-- =============================================================================
create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- ticket_id: REQUIRED. Composite FK (ticket_id, workspace_id) -> tickets(id,
  -- workspace_id) guarantees the referenced ticket lives in THIS event's workspace
  -- (see COMPOSITE-FK REUSE in the header). on delete cascade: deleting a ticket
  -- (or, transitively, its property/workspace) removes its events. NOTE: cascade
  -- delete of the PARENT is a data-model cleanup, not an in-app mutation — it does
  -- not conflict with append-only, which forbids UPDATE/DELETE of an event ROW while
  -- its ticket still exists.
  ticket_id uuid not null,

  -- actor_user_id: NULLABLE. The human who caused the event, when there is one. NULL
  -- for SYSTEM / AI / AUTOMATION actors (no user). Plain FK to profiles(id) — like
  -- tickets.created_by_user_id, profiles is referenced plainly and cross-workspace
  -- integrity for the actor is not embedded here (the actor may legitimately be a
  -- platform SUPER_ADMIN or a system principal); the (ticket_id, workspace_id)
  -- composite FK is what pins the event to the right workspace.
  actor_user_id uuid references public.profiles (id),

  actor_type public.actor_type not null default 'USER',
  event_type public.ticket_event_type not null,

  -- Structured before/after payloads and free-form metadata for the event. e.g. a
  -- STATUS_CHANGED event carries old_value_json = {"status":"NEW"},
  -- new_value_json = {"status":"TRIAGE"}. All nullable — many events (TICKET_CREATED)
  -- have no "old" value.
  old_value_json jsonb,
  new_value_json jsonb,
  metadata_json jsonb,

  -- created_at only — NO updated_at. Events are IMMUTABLE: they are appended once and
  -- never updated, so there is no "last modified" concept and no set_updated_at
  -- trigger. This is deliberate and load-bearing for the audit story.
  created_at timestamptz not null default now(),

  constraint ticket_events_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete cascade
);

create index ticket_events_workspace_ticket_idx
  on public.ticket_events (workspace_id, ticket_id);

-- -----------------------------------------------------------------------------
-- APPEND-ONLY ENFORCEMENT — done TWO ways (belt AND suspenders):
--
-- (1) RLS: an INSERT policy ONLY. There is NO update policy and NO delete policy, so
--     RLS DEFAULT-DENIES update/delete for the normal PostgREST roles (anon /
--     authenticated). A tenant/manager cannot rewrite or erase history through the
--     API. See the ticket_events_insert_manager policy below for the INSERT gate and
--     its manager-only DECISION.
--
-- (2) A BEFORE UPDATE OR DELETE trigger that unconditionally RAISES. RLS closes the
--     API path, but a SECURITY DEFINER function (like log_ticket_event below) or a
--     service-role connection runs with RLS BYPASSED — RLS alone would not stop an
--     elevated path from mutating an event by accident (a buggy admin script, a
--     future definer helper). The trigger fires for EVERY role including owner /
--     definer / service_role and hard-stops the mutation at the row level. Together:
--     RLS blocks the untrusted API path; the trigger blocks even trusted/elevated
--     paths from silently rewriting the audit log. INSERTs are unaffected (the
--     trigger only fires on UPDATE/DELETE), so appending new events still works.
--
--     The trigger function is plain (SECURITY INVOKER is fine — it only raises); it
--     does not read any table, so search_path shadowing is not a concern, but we pin
--     it anyway for consistency with the codebase convention.
-- -----------------------------------------------------------------------------
create or replace function public.ticket_events_prevent_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ticket_events is append-only: % is not permitted', tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger ticket_events_no_mutation
  before update or delete on public.ticket_events
  for each row execute function public.ticket_events_prevent_mutation();

alter table public.ticket_events enable row level security;

-- SELECT — managers + accountant see the workspace's event log; tenants/guests/
-- vendors do NOT get a workspace-wide event feed. This mirrors 0011's
-- tickets_select_manager_or_accountant (managers/accountant see all workspace
-- tickets). The audit log is an operational/oversight surface; per-ticket event
-- history for a tenant's own ticket, if ever surfaced to tenants, would be exposed
-- through an app-layer read that filters events, not through a broad tenant RLS
-- policy here. Keeping tenant SELECT off the raw event log avoids leaking, e.g., a
-- VENDOR_ASSIGNED or internal COMMENT_ADDED event's metadata to the reporter. Plus
-- the SUPER_ADMIN cross-workspace platform override (SELECT only, read-only).
create policy "ticket_events_select_manager_or_accountant"
  on public.ticket_events for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT — MANAGER-ONLY. This is the key DECISION for this table.
--
-- THE THREAT: ticket_events is an AUDIT log. If a tenant (lowest-trust role that can
-- reach PostgREST with a JWT) could INSERT arbitrary events, they could POST a
-- forged STATUS_CHANGED / TICKET_CLOSED / OPERATOR_ASSIGNED row directly, polluting
-- the tamper-evident history with fabricated entries. For an audit log, integrity is
-- the whole point, so we do NOT grant workspace-member insert.
--
-- THE DECISION (spec option (a)): restrict direct INSERT to managers
-- (is_workspace_manager(): SUPER_ADMIN / OWNER / OPERATOR, is_active-aware, EXCLUDES
-- ACCOUNTANT and all tenant-class roles) within their own workspace. is_active-aware
-- so a deactivated manager cannot append either.
--
-- HOW TENANT-LEGIT EVENTS STILL GET LOGGED: some events are legitimately caused by a
-- tenant — a tenant creating a ticket SHOULD produce a TICKET_CREATED event; a tenant
-- posting a PUBLIC comment SHOULD produce a COMMENT_ADDED event. Those are written
-- NOT by a direct tenant insert (blocked here) but by the SECURITY DEFINER helper
-- public.log_ticket_event(...) defined below, which runs as owner and therefore
-- BYPASSES this manager-only policy. P3.4's ticket-creation and comment-post paths
-- MUST route their event-logging through log_ticket_event (or an equivalent definer
-- path) rather than inserting into ticket_events directly as the tenant. This keeps
-- the audit log un-forgeable via raw PostgREST while still recording tenant-driven
-- events through a controlled, app-owned funnel that stamps actor_user_id/actor_type
-- itself.
--
-- No SUPER_ADMIN platform-write override (NULL workspace -> `workspace_id = NULL`
-- -> NULL -> rejected, three-valued logic), same fail-closed posture as 0011 writes.
create policy "ticket_events_insert_manager"
  on public.ticket_events for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.is_workspace_manager()
  );

-- No UPDATE policy, no DELETE policy — see APPEND-ONLY ENFORCEMENT (1). Combined with
-- the mutation trigger (2), events are immutable through every path.

-- -----------------------------------------------------------------------------
-- SECURITY DEFINER helper: log_ticket_event(...)
--
-- The controlled funnel through which the APP (P3.4) records events, including
-- tenant-driven ones, without granting tenants direct insert on the manager-only
-- ticket_events table. Because it is SECURITY DEFINER it runs as the owner and
-- BYPASSES ticket_events_insert_manager, so a tenant-initiated TICKET_CREATED /
-- COMMENT_ADDED is recorded even though the tenant could not insert the event row
-- themselves.
--
-- SAFETY OF THE DEFINER PATH:
--   * It pins the event to a workspace via p_workspace_id and enforces that the
--     (ticket, workspace) pair actually exists in THAT workspace (via the composite
--     FK on insert — a mismatched pair is rejected by ticket_events_ticket_fk), so
--     it cannot be coaxed into planting a cross-workspace event.
--   * It NEVER lets a caller mutate an existing event (it only inserts; the
--     append-only trigger blocks update/delete even here).
--   * Pinned search_path = public (definer hardening; do NOT remove).
--   * VOLATILE (it writes), unlike the STABLE read helpers.
--
-- NOTE for P3.4: the CALLER decides actor_type/actor_user_id/event_type — this helper
-- does not itself authorize WHO may cause WHICH event; that authorization lives in the
-- P3.4 server actions that call it (they run after requirePermission/ownership checks).
-- The helper's job is solely to append the row past the manager-only insert gate. Do
-- not expose it to the client as an unrestricted RPC without the app-layer guard.
-- -----------------------------------------------------------------------------
create or replace function public.log_ticket_event(
  p_workspace_id uuid,
  p_ticket_id uuid,
  p_event_type public.ticket_event_type,
  p_actor_user_id uuid default null,
  p_actor_type public.actor_type default 'USER',
  p_old_value_json jsonb default null,
  p_new_value_json jsonb default null,
  p_metadata_json jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ticket_events (
    workspace_id, ticket_id, actor_user_id, actor_type, event_type,
    old_value_json, new_value_json, metadata_json
  ) values (
    p_workspace_id, p_ticket_id, p_actor_user_id, p_actor_type, p_event_type,
    p_old_value_json, p_new_value_json, p_metadata_json
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- SECURITY-CRITICAL: lock this SECURITY DEFINER function to server-side callers.
-- Postgres grants EXECUTE to PUBLIC by default, and PostgREST auto-exposes public
-- functions as RPCs — so without this revoke, ANY tenant could call
-- supabase.rpc('log_ticket_event', {...}) and forge arbitrary audit events
-- (fabricated TICKET_CLOSED, spoofed actor_user_id, framing another user),
-- bypassing the manager-only ticket_events_insert_manager policy entirely and
-- defeating the whole point of an append-only audit log. This function performs
-- NO internal authorization by design (P3.4's server actions authorize before
-- calling it via the service-role client, which is unaffected by this revoke).
-- Contrast 0006's create_workspace_and_claim_owner, which IS granted to
-- authenticated precisely because it self-authorizes internally; this one does not.
revoke execute on function public.log_ticket_event(
  uuid, uuid, public.ticket_event_type, uuid, public.actor_type, jsonb, jsonb, jsonb
) from public;

-- =============================================================================
-- TABLE: public.ticket_comments  (PUBLIC / INTERNAL visibility)
-- =============================================================================
create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- ticket_id: REQUIRED. Composite FK (ticket_id, workspace_id) -> tickets(id,
  -- workspace_id) — same workspace-pinning as ticket_events. on delete cascade.
  ticket_id uuid not null,

  -- author_user_id: NOT NULL. The commenter. A human always authors a comment (even
  -- AI_NOTE / SYSTEM_NOTE comments are attributed to the acting user in MVP). Plain FK
  -- to profiles(id). The INSERT policies pin this to auth.uid() so you can only
  -- comment AS yourself.
  author_user_id uuid not null references public.profiles (id),

  body text not null,

  -- visibility: PUBLIC (tenant-facing thread) vs INTERNAL (staff-only). This is THE
  -- security-sensitive column: a tenant/guest must NEVER read an INTERNAL comment,
  -- even on their own ticket. Defaults to PUBLIC.
  visibility public.comment_visibility not null default 'PUBLIC',

  -- type: MESSAGE (a normal note) vs SYSTEM_NOTE / AI_NOTE (machine-generated notes).
  type public.comment_type not null default 'MESSAGE',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ticket_comments_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete cascade
);

create index ticket_comments_workspace_ticket_idx
  on public.ticket_comments (workspace_id, ticket_id);

create trigger ticket_comments_set_updated_at
  before update on public.ticket_comments
  for each row execute function public.set_updated_at();

alter table public.ticket_comments enable row level security;

-- -----------------------------------------------------------------------------
-- Row Level Security — THE INTERNAL/PUBLIC BOUNDARY
--
-- NULL-safety (same three-valued-logic rationale as 0002/0011): a caller whose
-- current_workspace_id() is NULL matches no rows; current_role() is NULL only for a
-- caller with no profile row, which fails every policy closed. user_owns_ticket()
-- returns FALSE (never NULL) for non-owners, so tenant policies fail closed too.
--
-- Two OR'd permissive SELECT policies (Postgres OR's permissive policies for the same
-- command): a manager/accountant matches the first (sees ALL comments — public AND
-- internal); a tenant/guest matches the second ONLY for PUBLIC comments on tickets
-- they reported.
-- -----------------------------------------------------------------------------

-- SELECT policy 1 — managers + accountant see ALL comments (public AND internal) on
-- workspace tickets. Mirrors 0011's manager/accountant SELECT. Plus the SUPER_ADMIN
-- cross-workspace platform override (read-only oversight).
create policy "comments_select_manager"
  on public.ticket_comments for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

-- SELECT policy 2 — tenant/guest see PUBLIC comments ONLY, and ONLY on tickets they
-- reported. THE INTERNAL-COMMENT LEAK IS CLOSED HERE by the `visibility = 'PUBLIC'`
-- conjunct: even on a ticket the caller OWNS, an INTERNAL comment fails this policy
-- (visibility != 'PUBLIC'), and since tenants match NO other SELECT policy (policy 1
-- excludes their role), the INTERNAL row is invisible to them — full stop. Ownership
-- is checked via the user_owns_ticket() SECURITY DEFINER helper (NOT an inline
-- tickets subquery), so the check is self-contained and does not re-enter tickets'
-- RLS (see the helper's header). A row is visible under this policy IFF it is PUBLIC
-- AND on a ticket the caller reported.
--   NOTE: this policy does not re-assert `workspace_id = current_workspace_id()`
--   because user_owns_ticket() already constrains to a ticket the caller created,
--   which (via the composite FK) lives in the caller's workspace; the workspace check
--   is implied. It is harmless to add, but the ownership predicate is the binding one.
create policy "comments_select_own_public"
  on public.ticket_comments for select
  using (
    visibility = 'PUBLIC'
    and public.user_owns_ticket(ticket_id)
  );

-- INSERT policy 1 — tenant/guest may insert PUBLIC comments on their OWN tickets. The
-- WITH CHECK PINS visibility = 'PUBLIC': this is what blocks a tenant from injecting
-- an INTERNAL comment (a tenant POSTing `visibility: 'INTERNAL'` fails the check and
-- is rejected). Also pins:
--   * workspace_id = current_workspace_id() — no cross-workspace planting;
--   * author_user_id = auth.uid() — you can only comment AS yourself;
--   * user_owns_ticket(ticket_id) — only on a ticket you reported;
--   * coalesce(current_is_active(), false) — deactivated members (valid JWT) blocked;
--     fails closed if the caller has no profile.
-- Together: a tenant can only add a PUBLIC comment, authored by themselves, on their
-- own active-membership ticket. They cannot inject INTERNAL, cannot forge authorship,
-- cannot comment on someone else's ticket, cannot act while deactivated.
create policy "comments_insert_own_public"
  on public.ticket_comments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
    and visibility = 'PUBLIC'
    and public.user_owns_ticket(ticket_id)
    and coalesce(public.current_is_active(), false)
  );

-- INSERT policy 2 — managers may insert ANY comment (PUBLIC or INTERNAL) on any
-- workspace ticket. is_workspace_manager() is is_active-aware and excludes ACCOUNTANT
-- (accountants get read-only oversight via comments_select_manager, no comment write).
-- author_user_id = auth.uid() pins authorship to the acting manager. No ticket-
-- ownership constraint (managers legitimately comment on any ticket in their
-- workspace). This is the ONLY path that can create an INTERNAL comment — tenants are
-- pinned to PUBLIC by policy 1.
create policy "comments_insert_manager"
  on public.ticket_comments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and author_user_id = auth.uid()
    and public.is_workspace_manager()
  );

-- No UPDATE policy, no DELETE policy — INTENTIONAL. Comments are IMMUTABLE in the MVP:
-- RLS default-denies update/delete for everyone through the API. Edit/delete of a
-- comment is a Phase 4 concern (it needs its own audit story — who edited what, and
-- edited/deleted internal comments interact with the append-only event log). Keeping
-- comments append-like in the MVP keeps the audit story clean. Rows are still removed
-- by cascade when their ticket / property / workspace is deleted.
-- (The set_updated_at trigger is present for forward-compatibility when a Phase-4
-- update policy lands; today no policy permits UPDATE, so it simply never fires.)

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- COMMENTS — the internal/public boundary:
-- 1. A manager (OWNER / OPERATOR) in workspace X SELECTs a ticket's comments and sees
--    BOTH public AND internal comments (comments_select_manager). An ACCOUNTANT in X
--    also sees both (read-only oversight).
-- 2. A TENANT who reported ticket T SELECTs T's comments and sees ONLY the PUBLIC
--    ones — the INTERNAL comments on their OWN ticket are INVISIBLE
--    (comments_select_own_public's `visibility = 'PUBLIC'` conjunct; they match no
--    other SELECT policy). This is the core internal-comment-leak test.
-- 3. A TENANT SELECTs comments on a ticket they did NOT report (someone else's, same
--    workspace): ZERO rows — user_owns_ticket() returns false, and policy 1 excludes
--    their role. No public OR internal comment of another tenant's ticket leaks.
-- 4. A TENANT in workspace Y SELECTs ZERO of workspace X's comments (cross-workspace
--    isolation: user_owns_ticket() is false for X's tickets, policy 1 role-excluded).
-- 5. A TENANT CAN INSERT a PUBLIC comment (author = self) on a ticket they reported
--    (comments_insert_own_public). It appears in their own SELECT (case 2) and in the
--    manager's SELECT (case 1).
-- 6. ADVERSARIAL — a TENANT POSTing a comment with visibility = 'INTERNAL' on their
--    OWN ticket is REJECTED (comments_insert_own_public pins visibility = 'PUBLIC';
--    comments_insert_manager requires is_workspace_manager(), which the tenant is
--    not). No tenant-authored INTERNAL comment can ever be created — the visibility
--    pin closes injection on the INSERT side, mirroring the SELECT-side leak close.
-- 7. ADVERSARIAL — a TENANT POSTing a (PUBLIC) comment on a ticket they did NOT report
--    is REJECTED (user_owns_ticket() false in comments_insert_own_public;
--    is_workspace_manager() false in comments_insert_manager).
-- 8. ADVERSARIAL — a TENANT POSTing a comment with author_user_id = <someone else's>
--    is REJECTED (author_user_id != auth.uid()). No forging authorship.
-- 9. A MANAGER in X CAN INSERT an INTERNAL comment on any X ticket
--    (comments_insert_manager). A DEACTIVATED manager CANNOT (is_workspace_manager()
--    is is_active-aware). An ACCOUNTANT CANNOT insert any comment (excluded from both
--    insert policies) but CAN read all (case 1).
-- 10. No user (any role) can UPDATE or DELETE a comment through the API — no
--     update/delete policy, RLS default-denies. Edit/delete is Phase 4.
--
-- EVENTS — append-only + insert authorization:
-- 11. A MANAGER in X CAN INSERT an event for an X ticket (ticket_events_insert_manager).
--     A TENANT CANNOT insert an event directly (manager-only policy) — tenant-driven
--     TICKET_CREATED / COMMENT_ADDED events are recorded by P3.4 via the SECURITY
--     DEFINER log_ticket_event() funnel, not by a direct tenant insert.
-- 12. ADVERSARIAL — ANY role (including a manager or a service-role/definer path)
--     attempting UPDATE or DELETE on a ticket_events row is REJECTED: RLS default-
--     denies it for the API roles, AND the ticket_events_no_mutation trigger RAISES
--     for every role including owner/definer/service_role. The audit log cannot be
--     rewritten or erased in-app while its ticket exists. INSERT (append) still works.
-- 13. A TENANT / ACCOUNTANT SELECTs ZERO rows from ticket_events (only managers +
--     accountant... wait: ACCOUNTANT is INCLUDED in the SELECT policy — an ACCOUNTANT
--     SEES the workspace event log; a TENANT/GUEST/VENDOR sees ZERO). Cross-workspace:
--     a manager in Y sees ZERO of X's events.
-- 14. ADVERSARIAL — cross-workspace event/comment rejected by the COMPOSITE FK: an
--     insert with workspace_id = X and ticket_id = <a ticket owned by Y> is REJECTED
--     by ticket_events_ticket_fk / ticket_comments_ticket_fk (no tickets row has
--     (Y's ticket id, X) as an (id, workspace_id) pair) — even if the WITH CHECK
--     (which only inspects the child's own workspace_id) would have passed.
-- 15. log_ticket_event(): calling it (as the definer path P3.4 uses via the
--     service-role client) appends an event even for a tenant-initiated action,
--     bypassing the manager-only insert policy; the composite FK still forces the
--     (ticket, workspace) pair to be consistent, so it cannot plant a cross-workspace
--     event.
-- 16. ADVERSARIAL — a TENANT calling supabase.rpc('log_ticket_event', {...}) directly
--     is REJECTED with a permission-denied error: EXECUTE on log_ticket_event is
--     REVOKED from public (not granted to authenticated), so PostgREST cannot invoke
--     it for a tenant. This is what stops a tenant forging audit events (fabricated
--     TICKET_CLOSED, spoofed actor) through the definer RPC. The service-role client
--     P3.4 uses is unaffected (it is not subject to the revoke).
-- =============================================================================
