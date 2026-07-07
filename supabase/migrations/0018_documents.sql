-- =============================================================================
-- Migration 0018: Documents hub (general documents repo attached to any entity)
--                 + PRIVATE Storage bucket + storage.objects RLS + Row Level Security
-- =============================================================================
-- Adds `public.documents` — a GENERAL document repository. A document (a lease PDF, a
-- contract, a permit, an insurance certificate, an ID scan, an invoice) is stored as
-- BYTES in a PRIVATE Supabase Storage bucket ('documents'); a METADATA ROW in
-- public.documents links each stored object back to at most ONE entity (a property, a
-- unit, a tenancy, a vendor, or a ticket) — OR to none (a workspace-level document).
-- BOTH surfaces are workspace-scoped: the metadata row via table RLS (below), and the
-- Storage object via storage.objects RLS policies (also below) that key off the
-- object's PATH.
--
-- WHY PER-ENTITY NULLABLE COMPOSITE-FK COLUMNS (not a polymorphic entity_id): a single
-- `entity_type text + entity_id uuid` cannot be a foreign key (it points at different
-- tables per row), so Postgres could NOT enforce that entity_id belongs to THIS
-- document's workspace. That reopens exactly the FK-bypasses-RLS cross-tenant hole the
-- composite-FK pattern (0009/0011/0017) was built to close. Instead each supported
-- entity gets its OWN nullable column (property_id / unit_id / tenancy_id / vendor_id /
-- ticket_id), each with a NULLABLE composite FK back to (id, workspace_id) of its
-- parent. A document hangs off AT MOST ONE entity (application-enforced — the metadata
-- layer sets exactly one, or none), and every non-NULL link is un-bypassably pinned to
-- this document's workspace. Multi-tenant integrity is preserved.
--
-- PATH CONVENTION (load-bearing for the Storage policies):
--   workspace_id/<uuid>-<sanitized-filename>
-- The FIRST path segment is ALWAYS the workspace_id. Unlike 0015 attachments (which
-- nests under ticket_id as the second segment because visibility mirrors ticket
-- ownership), documents have NO per-entity second segment: document read/write is
-- role-gated (manager/accountant), NOT owner-scoped, so the only path-level control we
-- need is the workspace lock on segment [1]. The server ALWAYS builds this path from a
-- VALIDATED workspace_id (the caller's own, from the session) + a sanitized filename;
-- the client never chooses the workspace segment. The Storage RLS policies below
-- re-derive the workspace_id from (storage.foldername(name))[1], so even a client that
-- crafted a raw Storage request could only ever read/write objects under its OWN
-- workspace_id. DEFENSE-IN-DEPTH on top of the server-built path.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006-0017. This is the next
-- free lexical number, 0018 — numbered by apply position. Additive; no data exists.
-- Idempotent-safe guards (on conflict do nothing / drop policy if exists) on a re-run.
--
-- COMPOSITE-FK PREREQUISITES: four of the five parents already carry the required
-- unique(id, workspace_id): properties (0009), units (0011), vendors (0010),
-- tickets (0011 inline). TENANCIES (0016) does NOT — so this file ADDS it FIRST,
-- BEFORE the documents table, so the (tenancy_id, workspace_id) composite FK can
-- reference it. The ALTER is additive and safe (a unique on the (id, workspace_id)
-- pair; id is already the PK so no existing row can violate it).
--
-- HELPER REUSE: set_updated_at (0001), current_workspace_id / current_role /
-- is_workspace_manager (0002/0008) all exist and are REUSED, not redefined. The Storage
-- policies below invoke these SAME functions — storage.objects RLS is planned as the
-- querying role just like a public-table policy, so is_workspace_manager() works
-- identically there.
--
-- ROLE MODEL (same as 0015 attachments' manager surface, plus accountant read): READ is
-- role-gated to SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT (managers run ops; the
-- accountant needs read-only oversight of leases/invoices/insurance). WRITE
-- (INSERT/UPDATE) is is_workspace_manager() — SUPER_ADMIN / OWNER / OPERATOR — so
-- OPERATOR (a manager) manages documents, but ACCOUNTANT is READ-ONLY here (unlike
-- finance in 0017, the accountant does NOT get document write). TENANT / GUEST / VENDOR
-- get ZERO documents. No DELETE (Phase-4 concern, same as attachments/finance).
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PREREQUISITE: tenancies needs unique(id, workspace_id) for the composite FK.
-- Additive and safe (id is already the PK, so the pair is trivially unique).
-- -----------------------------------------------------------------------------
alter table public.tenancies
  add constraint tenancies_id_workspace_unique unique (id, workspace_id);

-- -----------------------------------------------------------------------------
-- ENUM: document_type — the kind of document (for display / filtering).
-- -----------------------------------------------------------------------------
create type public.document_type as enum (
  'LEASE', 'CONTRACT', 'PERMIT', 'CERTIFICATE', 'INSURANCE', 'ID', 'INVOICE', 'OTHER'
);

-- =============================================================================
-- TABLE: public.documents  (metadata linking a stored object to an entity, or none)
-- =============================================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- Per-entity OPTIONAL attribution. A document hangs off AT MOST ONE of these (or
  -- none — a workspace-level document). Each is a NULLABLE composite FK to its parent's
  -- (id, workspace_id) pair (MATCH SIMPLE — see NULLABLE-COMPOSITE-FK below). Which one
  -- is set (at most one) is enforced by the metadata layer, NOT a DB constraint here.
  property_id uuid,
  unit_id uuid,
  tenancy_id uuid,
  vendor_id uuid,
  ticket_id uuid,

  document_type public.document_type not null default 'OTHER',

  -- title: DISPLAY name for the document (human-entered, may differ from the filename).
  title text not null,

  -- storage_path: the object key in the 'documents' bucket, i.e.
  -- workspace_id/<uuid>-<sanitized-filename>. UNIQUE so the same object is never
  -- double-registered. The uuid prefix guarantees uniqueness even for same-named files.
  storage_path text not null unique,

  file_type text not null,   -- MIME type (validated against an allowlist in the action)
  file_size bigint not null, -- bytes (validated against a max size in the action)

  -- expires_at: OPTIONAL expiry date (e.g. an insurance certificate or permit valid
  -- until a date). NULL for documents that do not expire. Drives future expiry alerts.
  expires_at date,

  notes text,

  -- uploaded_by_user_id: NULLABLE. The uploader, when there is an authenticated one.
  -- Plain FK to profiles(id) (no workspace pin needed — a profile is global).
  uploaded_by_user_id uuid references public.profiles (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- NULLABLE composite FKs (MATCH SIMPLE — see the NULLABLE-COMPOSITE-FK block below):
  -- a NULL child id skips the check (that entity simply is not linked); a non-NULL child
  -- forces the referenced row to belong to THIS document's workspace. on delete cascade:
  -- deleting the entity (or, transitively, its workspace) removes documents attached to
  -- it. (For an unattached document, only the workspace cascade removes it.)
  constraint documents_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade,
  constraint documents_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade,
  constraint documents_tenancy_fk
    foreign key (tenancy_id, workspace_id)
    references public.tenancies (id, workspace_id) on delete cascade,
  constraint documents_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete cascade,
  constraint documents_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete cascade
);

-- NULLABLE-COMPOSITE-FK / MATCH SIMPLE (same subtlety as tickets.unit_id in 0011 and
-- the finance FKs in 0017): the five entity columns are all NULLABLE. Postgres FKs
-- default to MATCH SIMPLE, under which a multi-column FK is NOT CHECKED AT ALL if ANY
-- of its columns is NULL. Because workspace_id is NOT NULL, the only NULL column in each
-- pair is the child id — i.e. the "not linked to this entity" case — so a NULL child
-- legitimately skips its check. When a child id IS non-NULL, BOTH columns are non-NULL
-- and the pair is checked in full, enforcing that the referenced row belongs to THIS
-- document's workspace. This is the un-bypassable backstop for the FK-bypasses-RLS gap.

create index documents_workspace_id_idx on public.documents (workspace_id);

create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

alter table public.documents enable row level security;

-- -----------------------------------------------------------------------------
-- Row Level Security — role-gated (NOT open-select).
--
-- NULL-safety (same three-valued-logic rationale as 0011/0016/0017):
-- current_workspace_id() NULL -> `workspace_id = NULL` -> NULL -> excluded (no rows);
-- current_role() NULL (no profile) fails every policy closed.
-- -----------------------------------------------------------------------------

-- SELECT — managers + accountant see ALL of the workspace's documents, plus the
-- SUPER_ADMIN cross-workspace platform override (read-only oversight). Mirrors
-- tickets_select_manager_or_accountant / income_records_select_finance. TENANT / GUEST /
-- VENDOR match no role and get ZERO documents.
create policy "documents_select_manager_or_accountant"
  on public.documents for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT — managers only (SUPER_ADMIN / OWNER / OPERATOR via is_workspace_manager(),
-- which is is_active-aware and EXCLUDES ACCOUNTANT -> read-only here), own workspace
-- only. No SUPER_ADMIN platform write override (NULL workspace -> three-valued-logic
-- rejection): platform reach is read-only oversight; writing requires membership.
create policy "documents_insert_manager"
  on public.documents for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- UPDATE — managers only, own workspace. EXPLICIT WITH CHECK re-validates the NEW row,
-- so an `UPDATE ... SET workspace_id = <other workspace>` (a workspace-hop) is rejected
-- (the post-update workspace_id would no longer equal current_workspace_id()).
create policy "documents_update_manager"
  on public.documents for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — INTENTIONAL, same as 0015 attachments / 0017 finance. RLS
-- default-denies delete for every API role. Document delete (+ the matching
-- Storage-object removal + orphan cleanup) is a Phase-4 concern with its own audit
-- story. Rows are still removed by cascade when their linked entity / workspace is
-- deleted.

-- =============================================================================
-- SUPABASE STORAGE — private bucket + storage.objects RLS policies
-- =============================================================================
-- The bytes live here. The bucket is PRIVATE (public = false) so there are NO anonymous
-- public URLs — every download goes through a short-lived SIGNED URL the server
-- generates (createSignedUrl), and every upload/download is additionally gated by the
-- storage.objects RLS policies below.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- storage.objects RLS — keyed on the object PATH.
--
-- storage.objects already has RLS enabled by Supabase; we add policies scoped to
-- bucket_id = 'documents'. Postgres evaluates these as the QUERYING role (anon /
-- authenticated) just like a public-table policy, so the same helpers apply.
--
-- PATH PARSING: storage.foldername(name) splits the object key on '/' and returns the
-- FOLDER segments as a text[] (1-indexed). For key `workspace_id/<uuid>-<file>`,
-- foldername(name) = {workspace_id} (the final <uuid>-<file> is the object's basename,
-- not a folder segment). Thus (storage.foldername(name))[1] = the workspace_id segment.
--
-- THE CONTROL, in words: a caller may read/write a documents object IFF
--   (1) the object's FIRST path segment equals THEIR OWN current_workspace_id() — the
--       cross-workspace lock: an object under workspace Y's folder has first segment =
--       Y, which never equals a workspace-X caller's current_workspace_id(), so it is
--       invisible/unwritable to them; AND
--   (2) their role qualifies — SELECT: manager or accountant (mirrors the table SELECT);
--       INSERT: is_workspace_manager() (mirrors the table INSERT — accountant read-only).
--
-- PATH-TRAVERSAL ANALYSIS (why this is safe — same as 0015): the workspace_id segment is
-- NEVER client-chosen on the write path (the server builds it from the VALIDATED
-- session workspace_id and sanitize() strips '/', '\', '..' from the filename). Even a
-- raw crafted Storage PUT is forced by conjunct (1) to name the caller's OWN workspace
-- folder; a leading '../' makes the first segment '..' (or empty), which is not any real
-- workspace_id, so conjunct (1) fails closed. Storage treats the key as an opaque
-- string; there is no directory resolution that escapes the workspace prefix.
-- -----------------------------------------------------------------------------

-- SELECT (download) — own-workspace + (manager OR accountant). Mirrors the table SELECT.
drop policy if exists "documents_objects_select" on storage.objects;
create policy "documents_objects_select"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
  );

-- INSERT (upload) — own-workspace + manager (is_workspace_manager() is is_active-aware
-- and EXCLUDES accountant). Mirrors the table INSERT: accountant reads but does not
-- upload. A deactivated manager (valid JWT) is blocked by the is_active check inside
-- is_workspace_manager().
drop policy if exists "documents_objects_insert" on storage.objects;
create policy "documents_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.is_workspace_manager()
  );

-- No UPDATE / DELETE policy on storage.objects for this bucket — objects are immutable
-- through the API for the same reason document rows are (Phase-4 delete story).
-- service_role (server-side signing / any future cleanup job) bypasses RLS regardless.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project + Storage are wired:
-- =============================================================================
-- DOCUMENTS TABLE (metadata):
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X can
--    INSERT, UPDATE, and SELECT documents belonging to X
--    (documents_insert_manager / documents_update_manager /
--     documents_select_manager_or_accountant).
-- 2. An ACCOUNTANT in X can SELECT X's documents (read-only oversight) but CANNOT INSERT
--    or UPDATE them — is_workspace_manager() EXCLUDES ACCOUNTANT. (Contrast 0017 finance,
--    where the accountant DOES write; documents follow the attachments/ops model, so the
--    accountant is read-only here. Verify this asymmetry.)
-- 3. An OPERATOR in X can SELECT AND write (INSERT/UPDATE) X's documents
--    (is_workspace_manager() includes OPERATOR).
-- 4. A TENANT / GUEST / VENDOR in X SELECTs ZERO documents (role-gated, not open-select)
--    and CANNOT INSERT/UPDATE (no matching role). Full fail-closed isolation.
-- 5. Any user in workspace Y SELECTs ZERO of workspace X's documents (cross-workspace
--    tenant isolation — the core guarantee).
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a manager in Y running
--    `INSERT INTO documents (..., workspace_id) VALUES (..., <X's id>)` is rejected by
--    documents_insert_manager's WITH CHECK (NEW.workspace_id != current_workspace_id()).
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a manager in X running
--    `UPDATE documents SET workspace_id = <Y's id> WHERE ...` on a row they own is
--    rejected by documents_update_manager's WITH CHECK.
-- 8. ADVERSARIAL — cross-workspace entity link rejected by the COMPOSITE FK: an INSERT
--    with workspace_id = X and property_id (or unit_id / tenancy_id / vendor_id /
--    ticket_id) = <a row owned by Y> is REJECTED by the respective composite FK (no
--    parent has (Y's id, X) as an (id, workspace_id) pair) — even though the WITH CHECK,
--    which only inspects workspace_id, would have passed. Un-bypassable backstop. A NULL
--    child skips the check (MATCH SIMPLE) and inserts fine (document unattached).
-- 9. A DEACTIVATED manager in X (is_active = false) is REJECTED on INSERT and UPDATE:
--    0008 made is_workspace_manager() is_active-aware, and these policies call it by
--    name, so the block takes effect with no change to this file.
-- 10. No user (any role) can DELETE a document row through the API — no DELETE policy, so
--     RLS default-denies it. Rows are removed only by cascade (linked entity / workspace).
--
-- STORAGE OBJECTS (bytes) — the path-keyed control:
-- 11. A MANAGER in X can SELECT (sign/download) AND INSERT (upload) an object whose key
--     starts with X's workspace_id (foldername[1] = X, is_workspace_manager() true).
-- 12. An ACCOUNTANT in X can SELECT an object under `X/...` (foldername[1] = X, role in
--     the SELECT set) but CANNOT INSERT one (is_workspace_manager() false) — read-only
--     Storage access matching the table.
-- 13. CROSS-WORKSPACE — a user in workspace X CANNOT select/insert an object whose key
--     starts with workspace Y's id: foldername[1] = Y != current_workspace_id() = X, so
--     conjunct (1) fails. Holds for managers AND accountants — the workspace lock is the
--     outermost gate. THE key isolation guarantee.
-- 14. PATH TRAVERSAL — an attempted key with a leading `../` (e.g. `../Y/f`) has
--     foldername[1] = `..` (not a workspace_id), so conjunct (1) fails closed; the
--     server-built path never produces this anyway (sanitize + fixed prefix).
-- 15. A TENANT / GUEST / VENDOR CANNOT select or insert any documents object (role not in
--     either policy's role set / not a manager) — even under their own workspace folder.
-- 16. service_role (the server-side signer + any cleanup job) bypasses these policies
--     entirely.
-- =============================================================================
