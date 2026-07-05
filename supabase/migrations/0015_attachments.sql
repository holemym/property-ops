-- =============================================================================
-- Migration 0015: Ticket attachments (metadata table + PRIVATE Storage bucket
--                 + Storage RLS policies) + Row Level Security  [P3.9]
-- =============================================================================
-- Adds file attachments to tickets. A tenant photographs an issue; an operator or
-- vendor uploads proof-of-work; an accountant sees an invoice. The BYTES live in a
-- PRIVATE Supabase Storage bucket ('attachments'); a METADATA ROW in
-- public.attachments links each stored object back to its ticket (file name for
-- display, MIME, size, a type tag, who uploaded it). BOTH surfaces are
-- workspace-scoped: the metadata row via table RLS (below), and the Storage object
-- via storage.objects RLS policies (also below) that key off the object's PATH.
--
-- PATH CONVENTION (load-bearing for the Storage policies):
--   workspace_id/ticket_id/<uuid>-<sanitized-filename>
-- The FIRST path segment is ALWAYS the workspace_id and the SECOND is ALWAYS the
-- ticket_id. The server ALWAYS builds this path from a VALIDATED workspace_id +
-- ticket_id (buildStoragePath in src/lib/data/attachments.ts) — the client never
-- chooses the workspace/ticket segments, and the filename is sanitized to strip path
-- separators. The Storage RLS policies below re-derive the workspace_id from
-- (storage.foldername(name))[1] and the ticket_id from [2], so even a client that
-- crafted a raw Storage request could only ever read/write objects under its OWN
-- workspace_id (first segment must equal current_workspace_id()) for tickets it can
-- access. This is DEFENSE-IN-DEPTH on top of the server-built path.
--
-- MIGRATION NUMBERING: existing files are 0001..0014. 0013 = tenant portal, 0014 =
-- vendor job tokens. Next free lexical number is 0015. Additive; no data exists.
-- Idempotent-safe guards (if not exists / on conflict do nothing / drop policy if
-- exists) on a re-run.
--
-- HELPER REUSE: current_workspace_id (0002), current_role (0002), is_workspace_manager
-- (is_active-aware since 0008), current_is_active (0007), and user_owns_ticket (0012,
-- widened to created_by OR created_for in 0013) all exist and are REUSED. No new
-- helper is defined here. The Storage policies below invoke these SAME functions —
-- storage.objects RLS is planned as the querying role just like a public-table policy,
-- so is_workspace_manager()/user_owns_ticket() work identically there.
--
-- COMPOSITE-FK REUSE: tickets_id_workspace_unique (0011) lets the (ticket_id,
-- workspace_id) composite FK back to tickets pin cross-workspace integrity (an FK
-- checks row existence and BYPASSES RLS, so a plain ticket_id FK would let a caller
-- attach metadata to another workspace's ticket by guessing its id). Both FK columns
-- are NOT NULL, so the pair is always fully checked.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists).
-- =============================================================================

create type public.attachment_type as enum (
  'PHOTO', 'INVOICE', 'RECEIPT', 'CONTRACT', 'REPORT', 'OTHER'
);

-- =============================================================================
-- TABLE: public.attachments  (metadata linking a stored object to a ticket)
-- =============================================================================
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- ticket_id: REQUIRED. Composite FK (ticket_id, workspace_id) -> tickets(id,
  -- workspace_id) pins the attachment to a ticket in THIS workspace (see COMPOSITE-FK
  -- REUSE in the header). on delete cascade: deleting a ticket (or transitively its
  -- property/workspace) removes its attachment METADATA. NOTE: the Storage OBJECTS
  -- themselves are NOT cascade-deleted by this FK (Storage lives in a different schema
  -- with no FK back here) — orphaned objects are a Phase-4 cleanup-job concern, called
  -- out in the data layer. The metadata row going away already makes the object
  -- unreachable through the app (nothing signs a URL for it).
  ticket_id uuid not null,

  -- uploaded_by_user_id: NULLABLE. The uploader, when there is an authenticated one.
  -- NULL for VENDOR uploads via a job token — a vendor has no profile / auth.uid(), so
  -- there is no honest user id to record (same model as vendor comments/status: the
  -- token validation is the auth, the service client writes the row). Plain FK to
  -- profiles(id).
  uploaded_by_user_id uuid references public.profiles (id),

  -- file_name: the ORIGINAL filename, kept purely for DISPLAY. It may contain arbitrary
  -- characters (spaces, unicode, even `../`); it is NEVER used to build a path. The
  -- path-safe name lives inside storage_path (sanitized by buildStoragePath).
  file_name text not null,

  -- storage_path: the object key in the 'attachments' bucket, i.e.
  -- workspace_id/ticket_id/<uuid>-<sanitized-filename>. UNIQUE so the same object is
  -- never double-registered. The uuid prefix guarantees uniqueness even if two files
  -- share a name on the same ticket.
  storage_path text not null unique,

  file_type text not null,   -- MIME type (validated against an allowlist in the action)
  file_size bigint not null, -- bytes (validated against a max size in the action)

  attachment_type public.attachment_type not null default 'OTHER',
  created_at timestamptz not null default now(),

  constraint attachments_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete cascade
);

create index attachments_workspace_ticket_idx
  on public.attachments (workspace_id, ticket_id);

alter table public.attachments enable row level security;

-- -----------------------------------------------------------------------------
-- Row Level Security — MIRRORS TICKET VISIBILITY.
--
-- The rule: you can see a ticket's attachments exactly when you can see the ticket.
-- Two OR'd permissive SELECT policies (Postgres OR's permissive policies for the same
-- command): managers/accountant see ALL workspace attachments; a tenant sees the
-- attachments on a ticket they OWN.
--
-- NULL-safety (same three-valued-logic rationale as 0011/0012): current_workspace_id()
-- NULL -> no rows; current_role() NULL (no profile) fails closed; user_owns_ticket()
-- returns FALSE (never NULL) for non-owners, so the tenant policies fail closed.
--
-- NO PUBLIC/INTERNAL SPLIT: unlike ticket_comments, attachments have no visibility
-- axis in the MVP. An attachment on a ticket you own is yours to see — INTENDED: the
-- file was uploaded in the context of your maintenance request (your own photo, or a
-- proof/invoice tied to your ticket). There is no "staff-only attachment" concept yet;
-- if one is ever needed it is a Phase-4 visibility column mirroring comments.
-- -----------------------------------------------------------------------------

-- SELECT policy 1 — managers + accountant see ALL attachments on workspace tickets.
-- Mirrors tickets_select_manager_or_accountant / comments_select_manager. Plus the
-- SUPER_ADMIN cross-workspace platform override (read-only oversight).
create policy "attachments_select_manager_or_accountant"
  on public.attachments for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

-- SELECT policy 2 — a tenant/guest sees the attachments on a ticket they OWN (created_by
-- OR created_for, per user_owns_ticket post-0013), scoped to their own workspace.
-- user_owns_ticket() is the same SECURITY DEFINER ownership helper the comment policies
-- use, so this does not re-enter tickets' RLS.
create policy "attachments_select_own_ticket"
  on public.attachments for select
  using (
    workspace_id = public.current_workspace_id()
    and public.user_owns_ticket(ticket_id)
  );

-- INSERT policy 1 — managers may attach files to any workspace ticket. is_workspace_manager()
-- is is_active-aware and excludes ACCOUNTANT (read-only oversight, no upload). No
-- ticket-ownership constraint (managers legitimately attach to any ticket).
create policy "attachments_insert_manager"
  on public.attachments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and public.is_workspace_manager()
  );

-- INSERT policy 2 — a tenant/guest may attach a file to their OWN ticket, authored by
-- themselves. Pins:
--   * workspace_id = current_workspace_id() — no cross-workspace planting;
--   * uploaded_by_user_id = auth.uid() — you can only attach AS yourself (no forging
--     an upload "by" another user);
--   * user_owns_ticket(ticket_id) — only on a ticket you reported / were filed-for;
--   * coalesce(current_is_active(), false) — deactivated members (valid JWT) blocked;
--     fails closed if the caller has no profile.
-- Mirrors comments_insert_own_public exactly, minus the visibility pin (no visibility
-- axis here).
create policy "attachments_insert_own_ticket"
  on public.attachments for insert
  with check (
    workspace_id = public.current_workspace_id()
    and uploaded_by_user_id = auth.uid()
    and public.user_owns_ticket(ticket_id)
    and coalesce(public.current_is_active(), false)
  );

-- No UPDATE policy, no DELETE policy — INTENTIONAL. Attachments are IMMUTABLE in the
-- MVP: RLS default-denies update/delete for every API role. Delete (and the matching
-- Storage-object removal + orphan cleanup) is a Phase-4 concern with its own audit
-- story. Rows are still removed by cascade when their ticket / property / workspace is
-- deleted. VENDOR uploads (no auth.uid()) are written by the token action via the
-- SERVICE-ROLE client, which bypasses these policies entirely (same established model
-- as vendor comments/status); such a row has uploaded_by_user_id = NULL.

-- =============================================================================
-- SUPABASE STORAGE — private bucket + storage.objects RLS policies
-- =============================================================================
-- The bytes live here. The bucket is PRIVATE (public = false) so there are NO
-- anonymous public URLs — every download goes through a short-lived SIGNED URL the
-- server generates (createSignedUrl), and every upload/download is additionally gated
-- by the storage.objects RLS policies below.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- storage.objects RLS — THE KEY ACCESS CONTROL, keyed on the object PATH.
--
-- storage.objects already has RLS enabled by Supabase; we add policies scoped to
-- bucket_id = 'attachments'. Postgres evaluates these as the QUERYING role (anon /
-- authenticated) just like a public-table policy, so the same helper functions apply.
--
-- PATH PARSING: storage.foldername(name) splits the object key on '/' and returns the
-- FOLDER segments as a text[] (1-indexed). For key
-- `workspace_id/ticket_id/<uuid>-<file>`, foldername(name) = {workspace_id, ticket_id}
-- (the final <uuid>-<file> is the object's basename, not a folder segment). Thus:
--   (storage.foldername(name))[1] = the workspace_id segment
--   (storage.foldername(name))[2] = the ticket_id segment
--
-- THE CONTROL, in words: a caller may read/write an attachments object IFF
--   (1) the object's FIRST path segment equals THEIR OWN current_workspace_id() — this
--       is the cross-workspace lock: an object under workspace Y's folder has first
--       segment = Y, which never equals a workspace-X caller's current_workspace_id(),
--       so it is invisible/unwritable to them; AND
--   (2) they are a manager (is_workspace_manager()) OR they own the ticket named by the
--       SECOND path segment (user_owns_ticket(second_segment::uuid)).
--
-- PATH-TRAVERSAL ANALYSIS (why this is safe):
--   * The workspace_id segment is NEVER client-chosen on the write path: the server
--     action builds the key from the VALIDATED workspace_id (the caller's own, from the
--     session) + ticket_id, and sanitize() strips '/', '\', '..' and anything outside
--     [A-Za-z0-9._-] from the FILENAME before it becomes the basename. So a filename
--     like `../../etc/passwd` cannot inject extra '/' segments — it becomes
--     `.._.._etc_passwd` inside the single basename component.
--   * Even IF a client crafted a raw Storage PUT with an arbitrary key, policy conjunct
--     (1) forces the first segment to equal current_workspace_id() — the client cannot
--     name another workspace's folder and pass the INSERT check. And '..' cannot climb
--     out: Storage treats the key as an OPAQUE string, foldername() parses literal '/'
--     segments, and a leading '../' would make the first segment `..` (or empty), which
--     is not any real workspace_id, so conjunct (1) fails closed. There is no directory
--     resolution that would let `foo/../../bar` escape to `bar`.
--   * The ticket_id segment is likewise re-validated: user_owns_ticket(second::uuid)
--     (for tenants) confirms the caller actually owns THAT ticket; a manager path
--     requires is_workspace_manager() in the same (already workspace-locked) folder.
--     So a tenant cannot read another tenant's ticket folder even within their own
--     workspace, and no one can act cross-workspace.
--   * `((storage.foldername(name))[2])::uuid` casts the second segment to uuid; a
--     non-uuid second segment raises on cast → the row is excluded (fail closed), so a
--     malformed key cannot slip through the ownership check.
-- -----------------------------------------------------------------------------

-- SELECT (download) — own-workspace + (manager OR owns the ticket). This gates the
-- authenticated-client download path AND is the policy the service-role signer relies
-- on being consistent with (the signer itself is service_role and bypasses RLS, but it
-- only ever signs paths it fetched from an already-RLS-scoped attachments row).
drop policy if exists "attachments_objects_select" on storage.objects;
create policy "attachments_objects_select"
  on storage.objects for select
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

-- INSERT (upload) — own-workspace + (manager OR owns the ticket) + active. Mirrors the
-- table INSERT policies. The active check blocks a deactivated member (valid JWT) from
-- writing bytes even if they somehow reached Storage directly.
drop policy if exists "attachments_objects_insert" on storage.objects;
create policy "attachments_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and coalesce(public.current_is_active(), false)
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

-- No UPDATE / DELETE policy on storage.objects for this bucket — objects are immutable
-- through the API for the same reason attachment rows are (Phase-4 delete story).
-- service_role (server-side signing / any future cleanup job) bypasses RLS regardless.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project + Storage are wired:
-- =============================================================================
-- ATTACHMENTS TABLE (metadata):
-- 1. A manager/OWNER/OPERATOR in workspace X SELECTs ALL of X's attachment rows
--    (attachments_select_manager_or_accountant). An ACCOUNTANT in X also sees all
--    (read-only oversight).
-- 2. A TENANT who OWNS ticket T SELECTs T's attachment rows (attachments_select_own_ticket
--    via user_owns_ticket). They see ZERO attachment rows on tickets they do NOT own.
-- 3. A TENANT in workspace Y SELECTs ZERO of workspace X's attachment rows
--    (user_owns_ticket false for X's tickets; policy 1 role-excludes them).
-- 4. A MANAGER in X CAN INSERT an attachment row for any X ticket
--    (attachments_insert_manager). A TENANT CAN INSERT a row for a ticket they OWN with
--    uploaded_by_user_id = their auth.uid() (attachments_insert_own_ticket).
-- 5. ADVERSARIAL — a TENANT inserting a row with uploaded_by_user_id = <someone else's>
--    is REJECTED (uploaded_by != auth.uid()); on a ticket they do NOT own is REJECTED
--    (user_owns_ticket false); a DEACTIVATED member is REJECTED (current_is_active false).
-- 6. No user (any role) can UPDATE or DELETE an attachment row through the API (no
--    update/delete policy; RLS default-denies). Delete is Phase 4.
-- 7. ADVERSARIAL — cross-workspace ticket_id rejected by the COMPOSITE FK: inserting a
--    row with workspace_id = X and ticket_id = <a ticket in Y> fails attachments_ticket_fk.
--
-- STORAGE OBJECTS (bytes) — the path-keyed control:
-- 8. A MANAGER in X can SELECT (sign/download) an object whose key starts with X's
--    workspace_id (foldername[1] = X, is_workspace_manager() true).
-- 9. A TENANT who owns ticket T can SELECT an object under `X/T/...` (foldername[1] = X
--    = their workspace, user_owns_ticket(T) true). They CANNOT select an object under
--    `X/T2/...` for a ticket T2 they do NOT own (user_owns_ticket(T2) false, and they
--    are not a manager) — no cross-tenant file read within the same workspace.
-- 10. CROSS-WORKSPACE — a user in workspace X CANNOT select/insert an object whose key
--     starts with workspace Y's id: foldername[1] = Y != current_workspace_id() = X, so
--     conjunct (1) fails. This holds for BOTH managers and tenants — the workspace lock
--     is the outermost gate. THE key isolation guarantee.
-- 11. PATH TRAVERSAL — an attempted key with a leading `../` (e.g. `../Y/T/f`) has
--     foldername[1] = `..` (not a workspace_id), so conjunct (1) fails closed; the
--     server-built path never produces this anyway (sanitize + fixed prefix).
-- 12. A DEACTIVATED member CANNOT INSERT an object (current_is_active false in the
--     insert check), even under their own workspace folder.
-- 13. service_role (the server-side signer + vendor-upload path) bypasses these policies
--     entirely — a vendor upload writes under `X/T/...` via the service client after
--     token validation; the corresponding attachments row has uploaded_by_user_id NULL.
-- =============================================================================
