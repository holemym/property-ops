-- =============================================================================
-- Migration 0026: In-app notifications (Track P2) + Row Level Security
-- =============================================================================
-- Adds `public.notifications` — a per-user inbox of in-app pings for events the
-- system already emits: ticket assignment, status change, comment. v1 is
-- event-driven only, written by the same src/app/(app)/tickets/actions.ts
-- server actions that already fire the Phase-4 email hooks
-- (src/lib/email/notify.ts) — see
-- docs/superpowers/specs/2026-07-12-property-ops-p2-notifications-design.md §1-2.
--
-- MIGRATION NUMBERING: existing files run 0001-0025. Next free lexical number
-- is 0026.
--
-- SHAPE: unlike every other domain table in this project, notifications
-- carries NO ticket_id / entity FK — `href` is a plain in-app path (e.g.
-- /tickets/<id>) built by the writer at insert time, not a foreign key. The
-- only references out of this table are recipient_user_id (a PLAIN FK to
-- profiles(id) — the established pattern for every *_user_id column in this
-- schema; see the P3.1 comment in src/lib/data/tickets.ts for why
-- user-reference columns are plain, not composite, FKs) and workspace_id (the
-- tenant boundary, cascade-deleted with the workspace).
--
-- -----------------------------------------------------------------------------
-- RLS — THE INTERESTING PART, READ CAREFULLY (flagged for prop-rls-reviewer):
-- -----------------------------------------------------------------------------
-- SELECT: STRICTLY OWN-INBOX — recipient_user_id = auth.uid() AND
-- workspace_id = current_workspace_id() AND is_active. This is a DELIBERATE
-- DEVIATION from the tenants (0025) / tenancies (0016) PII pattern, both of
-- which grant a SUPER_ADMIN platform read-all override: a notification is a
-- personal inbox item, not a workspace record, so there is NO manager or
-- SUPER_ADMIN override here — not even a workspace OWNER can read another
-- member's notifications, and SUPER_ADMIN gets no platform-oversight carve-out
-- either. Do not "fix" this by adding one; it is intentional (spec §1).
--
-- UPDATE (mark-read): the SAME predicate as SELECT, on both USING and WITH
-- CHECK — a recipient may only ever touch their own row, and cannot repoint an
-- update at someone else's row or hop it to another workspace.
--
--   ACCEPTED LIMITATION (spec §1, documented here per its instruction — do NOT
--   "fix" this with a SECURITY DEFINER RPC in v1): WITH CHECK only re-validates
--   ROW OWNERSHIP (recipient_user_id / workspace_id / is_active), not
--   individual columns. A recipient can therefore PATCH other columns of their
--   OWN row via PostgREST (e.g. rewrite `title`), not just `read_at`. Blast
--   radius is confined to their own inbox row, which they already have read
--   access to — a cosmetic self-inflicted edit, not a cross-user or
--   cross-workspace leak.
--
-- INSERT: ZERO POLICY — the same lock as vendor_job_tokens (0014). No `create
-- policy ... for insert` statement at all means default-DENY for BOTH `anon`
-- AND `authenticated`; the only principal that can write this table is
-- `service_role`, which BYPASSES RLS entirely and is used exclusively
-- server-side (SUPABASE_SERVICE_ROLE_KEY is server-only, never NEXT_PUBLIC —
-- src/lib/supabase/service.ts). The app's createNotification
-- (src/lib/notifications/notify-inapp.ts) is called only from
-- src/app/(app)/tickets/actions.ts server actions, which authorize the
-- request (requirePermission) BEFORE the notification write — same funnel
-- shape as log_ticket_event's audit writes, minus the SECURITY DEFINER RPC
-- indirection (this is a plain service-role `.insert()`, not an RPC, because
-- there is no append-only/no-update constraint to enforce here the way
-- ticket_events has one). DO NOT add an INSERT policy for `authenticated` —
-- the app never lets a user create a notification for themselves or anyone
-- else directly.
--
-- DELETE: none. RLS default-denies any command without a matching policy —
-- there is no soft/hard delete of a notification in v1 (it is cleared via
-- read_at, not removed).
--
-- -----------------------------------------------------------------------------
-- DEMO-RESET EXTENSION: reset_demo_workspace() (0023, tenants wipe added in
-- 0025) is extended via `create or replace` (Postgres has no ALTER FUNCTION
-- ADD LINE — the whole body is re-declared) to also wipe demo-workspace
-- notifications, so a demo visitor's in-app pings never survive a reset. This
-- body is BYTE-FOR-BYTE the 0025 version (diffed against the current
-- supabase/migrations/0025_tenants.sql before writing this file, specifically
-- to avoid repeating 0025's own caught incident of dropping a `-- Tickets`
-- comment line during its re-paste) with exactly ONE new delete line added,
-- grouped with the other ticket-sourced deletes (ticket_comments/
-- ticket_events) right after income_records — notifications are generated
-- FROM those same ticket actions, and (like every row in this function) carry
-- no dependents, so no ordering constraint forces a different position. No
-- seed notifications rows are added — only the wipe needs to happen, matching
-- the tenants (0025) precedent ("unaffected otherwise"). Flagged for RLS
-- review along with the rest of this file.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created
-- (the 0001/0002 lesson: PostgREST auto-exposes every public table the
-- instant it exists, so a table that lives even briefly without RLS is a
-- cross-tenant hole).
-- =============================================================================

create type public.notification_type as enum
  ('TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_COMMENT');

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  title text not null,            -- e.g. 'Ticket assigned to you'
  body text,                      -- e.g. the ticket title
  href text not null,             -- in-app link, e.g. /tickets/<id>
  read_at timestamptz,            -- null = unread
  created_at timestamptz not null default now()
);

-- Leads with recipient_user_id to match the SELECT/UPDATE policy predicates
-- and both hot-path queries (bell unread count, paged inbox listing).
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_user_id, read_at, created_at desc);

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as every RLS policy in this
-- project): a caller whose current_workspace_id() is NULL matches no rows
-- (`workspace_id = NULL` -> NULL -> excluded); current_role()/
-- current_is_active() are NULL only for a caller with no profile row, which
-- likewise fails every policy closed via the coalesce(..., false) guard.
-- -----------------------------------------------------------------------------

alter table public.notifications enable row level security;

-- SELECT: strictly own-inbox. See header — NO manager/SUPER_ADMIN override,
-- a deliberate deviation from the tenants/tenancies PII pattern.
create policy "notifications_select_own"
  on public.notifications for select
  using (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  );

-- UPDATE (mark-read): SAME predicate on both sides. See header's ACCEPTED
-- LIMITATION note for why WITH CHECK does not also pin individual columns.
create policy "notifications_update_own"
  on public.notifications for update
  using (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  )
  with check (
    recipient_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
    and coalesce(public.current_is_active(), false)
  );

-- INSERT: ZERO POLICY — intentionally no `create policy ... for insert`
-- statement. Default-deny for anon + authenticated; only service_role
-- (bypasses RLS) writes, via createNotification. DO NOT add a policy here.

-- No DELETE policy — intentional. RLS default-denies any command without a
-- matching policy, so DELETE is closed through the API.

-- -----------------------------------------------------------------------------
-- Demo-reset extension: wipe demo-workspace notifications too, so a demo
-- visitor's in-app pings don't survive a reset. See header for the
-- byte-for-byte-plus-one-line provenance of this body.
-- -----------------------------------------------------------------------------
create or replace function public.reset_demo_workspace() returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  demo_ws uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  seed_user uuid := '00000000-0000-0000-0000-00000000d3d0'::uuid;
  prop_ring uuid := '11111111-1111-1111-1111-111111110001'::uuid;
  prop_mhof uuid := '11111111-1111-1111-1111-111111110002'::uuid;
  unit_top1 uuid := '11111111-1111-1111-1111-111111110011'::uuid;
  unit_top2 uuid := '11111111-1111-1111-1111-111111110012'::uuid;
  unit_shop uuid := '11111111-1111-1111-1111-111111110013'::uuid;
  unit_buero uuid := '11111111-1111-1111-1111-111111110014'::uuid;
  vendor_plumb uuid := '11111111-1111-1111-1111-111111110021'::uuid;
  vendor_elec uuid := '11111111-1111-1111-1111-111111110022'::uuid;
  ticket_heat uuid := '11111111-1111-1111-1111-111111110031'::uuid;
  ticket_elec uuid := '11111111-1111-1111-1111-111111110032'::uuid;
  ticket_water uuid := '11111111-1111-1111-1111-111111110033'::uuid;
  tenancy_berger uuid := '11111111-1111-1111-1111-111111110041'::uuid;
  tenancy_cafe uuid := '11111111-1111-1111-1111-111111110042'::uuid;
  invoice_ring uuid := '11111111-1111-1111-1111-111111110051'::uuid;
begin
  -- Wipe, children before parents. Everything is scoped to demo_ws.
  delete from public.invoice_line_items where workspace_id = demo_ws;
  delete from public.invoices where workspace_id = demo_ws;
  delete from public.documents where workspace_id = demo_ws;
  delete from public.expense_records where workspace_id = demo_ws;
  delete from public.income_records where workspace_id = demo_ws;
  delete from public.notifications where workspace_id = demo_ws;
  delete from public.ticket_comments where workspace_id = demo_ws;
  delete from public.ticket_events where workspace_id = demo_ws;
  delete from public.vendor_job_tokens where workspace_id = demo_ws;
  delete from public.attachments where workspace_id = demo_ws;
  delete from public.tenancies where workspace_id = demo_ws;
  delete from public.tenants where workspace_id = demo_ws;
  delete from public.tickets where workspace_id = demo_ws;
  delete from public.units where workspace_id = demo_ws;
  delete from public.vendors where workspace_id = demo_ws;
  delete from public.properties where workspace_id = demo_ws;

  -- Properties
  insert into public.properties (id, workspace_id, name, address_line1, city, postal_code, country, property_type, status)
  values
    (prop_ring, demo_ws, 'Ringstrasse Residenz', 'Ringstrasse 12', 'Wien', '1010', 'Austria', 'APARTMENT_BUILDING', 'ACTIVE'),
    (prop_mhof, demo_ws, 'Mariahilfer Hof', 'Mariahilfer Strasse 88', 'Wien', '1070', 'Austria', 'MIXED_USE', 'ACTIVE');

  -- Units
  insert into public.units (id, workspace_id, property_id, label, floor, occupancy_type, status)
  values
    (unit_top1, demo_ws, prop_ring, 'Top 1', '1', 'LONG_TERM', 'OCCUPIED'),
    (unit_top2, demo_ws, prop_ring, 'Top 2', '2', 'VACANT', 'VACANT'),
    (unit_shop, demo_ws, prop_mhof, 'Shop EG', '0', 'LONG_TERM', 'OCCUPIED'),
    (unit_buero, demo_ws, prop_mhof, 'Buero 1.OG', '1', 'VACANT', 'VACANT');

  -- Vendors
  insert into public.vendors (id, workspace_id, company_name, contact_name, service_category, is_active)
  values
    (vendor_plumb, demo_ws, 'Wiener Rohrservice GmbH', 'Hans Gruber', 'PLUMBING', true),
    (vendor_elec, demo_ws, 'Elektro Bauer', 'Eva Bauer', 'ELECTRICAL', true);

  -- Tickets
  -- The tickets_force_safe_insert_defaults BEFORE-INSERT trigger treats auth.uid()=null
  -- (true inside this SECURITY DEFINER function) as a non-manager and would flatten the
  -- seeded statuses/costs to NEW/null - disable it around the seed insert (the exact
  -- gotcha hit during the original live seeding; see the demo-mode spec section 2).
  alter table public.tickets disable trigger tickets_force_safe_insert_defaults;

  insert into public.tickets (
    id, workspace_id, property_id, unit_id, created_by_user_id, title, description,
    category, priority, status, assigned_vendor_id, estimated_cost, actual_cost, resolved_at, created_at
  ) values
    (ticket_heat, demo_ws, prop_ring, unit_top1, seed_user, 'Heizung faellt aus',
     'Heating stopped working overnight, tenant reports no hot water either.',
     'HEATING', 'HIGH', 'ASSIGNED', vendor_plumb, 200, null, null, now() - interval '3 days'),
    (ticket_elec, demo_ws, prop_mhof, unit_shop, seed_user, 'Steckdose defekt Kueche',
     'One socket in the shop kitchenette has stopped working.',
     'ELECTRICAL', 'NORMAL', 'NEW', null, null, null, null, now() - interval '1 day'),
    (ticket_water, demo_ws, prop_ring, unit_top1, seed_user, 'Wasserschaden im Bad',
     'Water damage found under the bathroom sink, now repaired.',
     'DAMAGE', 'URGENT', 'RESOLVED', vendor_plumb, 400, 450, now() - interval '2 days', now() - interval '5 days');

  alter table public.tickets enable trigger tickets_force_safe_insert_defaults;

  -- A couple of ticket events + one comment, for a non-empty activity timeline.
  insert into public.ticket_events (workspace_id, ticket_id, actor_user_id, actor_type, event_type, created_at)
  values
    (demo_ws, ticket_heat, seed_user, 'USER', 'TICKET_CREATED', now() - interval '3 days'),
    (demo_ws, ticket_heat, seed_user, 'USER', 'VENDOR_ASSIGNED', now() - interval '2 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CREATED', now() - interval '5 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CLOSED', now() - interval '2 days');

  insert into public.ticket_comments (workspace_id, ticket_id, author_user_id, body, visibility, type)
  values (demo_ws, ticket_heat, seed_user, 'Vendor scheduled for tomorrow morning.', 'PUBLIC', 'MESSAGE');

  -- Tenancies (one ending within 60 days -> exercises the rent-roll/documents lease alert)
  insert into public.tenancies (id, workspace_id, unit_id, tenant_name, start_date, end_date, rent_amount, created_by_user_id)
  values
    (tenancy_berger, demo_ws, unit_top1, 'Familie Berger', current_date - interval '18 months', null, 1250, seed_user),
    (tenancy_cafe, demo_ws, unit_shop, 'Cafe Sonne GmbH', current_date - interval '13 months', current_date + interval '45 days', 2400, seed_user);

  -- Income (this month's rent for the two occupied units)
  insert into public.income_records (workspace_id, unit_id, amount, category, period_start, period_end, notes, created_by_user_id)
  values
    (demo_ws, unit_top1, 1250, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user),
    (demo_ws, unit_shop, 2400, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user);

  -- Expense (one ticket-settling, one property-level utility)
  insert into public.expense_records (workspace_id, property_id, unit_id, ticket_id, amount, category, incurred_on, notes, created_by_user_id)
  values
    (demo_ws, null, unit_top1, ticket_water, 450, 'MAINTENANCE', current_date - 2, 'Plumber invoice — water damage repair', seed_user),
    (demo_ws, prop_mhof, null, null, 180, 'UTILITIES', current_date - 5, 'Common-area electricity', seed_user);

  -- Documents (a lease + a soon-expiring certificate, metadata-only — no real files)
  insert into public.documents (workspace_id, document_type, title, storage_path, file_type, file_size, expires_at, tenancy_id, unit_id, uploaded_by_user_id)
  values
    (demo_ws, 'LEASE', 'Lease - Familie Berger (Top 1)', demo_ws::text || '/demo-lease-top1.pdf', 'application/pdf', 210000, null, tenancy_berger, null, seed_user),
    (demo_ws, 'CERTIFICATE', 'Gas safety certificate - Top 1', demo_ws::text || '/demo-cert-top1.pdf', 'application/pdf', 88000, current_date + 25, null, unit_top1, seed_user);

  -- Invoice (outbound to the owner, sent, with one line item)
  insert into public.invoices (id, workspace_id, invoice_number, party_type, party_name, direction, status, property_id, issue_date, due_date, created_by_user_id)
  values (invoice_ring, demo_ws, 'DEMO-2026-0001', 'OWNER', 'Demo Owner Co', 'OUTBOUND', 'SENT', prop_ring, current_date - 5, current_date + 25, seed_user);

  insert into public.invoice_line_items (workspace_id, invoice_id, description, quantity, unit_amount, sort_order)
  values (demo_ws, invoice_ring, 'Property management fee — July', 1, 500, 0);

  update public.workspaces set demo_reset_at = now() where id = demo_ws;
end;
$$;

revoke execute on function public.reset_demo_workspace() from public;
grant execute on function public.reset_demo_workspace() to service_role;

-- =============================================================================
-- SMOKE TESTS — run these manually once applied to a live Supabase project:
-- =============================================================================
-- 1. OWN-INBOX SELECT: a user (any role) SELECTs exactly their own
--    notifications — rows for a DIFFERENT recipient_user_id in the SAME
--    workspace return ZERO, even for OWNER/SUPER_ADMIN. No manager override.
-- 2. CROSS-WORKSPACE ISOLATION: a user in workspace Y SELECTs ZERO of
--    workspace X's notifications, even if (hypothetically) their auth.uid()
--    matched a recipient_user_id there (cannot happen via the app, since
--    recipient_user_id is always an in-workspace profile id — this is the
--    workspace_id backstop anyway).
-- 3. NOT INSERTABLE BY AUTHENTICATED: a logged-in user (any role, including
--    OWNER) attempting `insert into notifications (...)` via PostgREST is
--    rejected — zero INSERT policy, default-deny.
-- 4. NOT INSERTABLE BY ANON: same as #3 for an anonymous caller.
-- 5. MARK-READ WORKS: a user UPDATEs `read_at` on their OWN row — succeeds.
-- 6. MARK-READ REJECTED CROSS-USER: a user attempting to UPDATE another
--    user's notification row (by guessing/enumerating an id) matches zero
--    rows (USING clause) — no error, just no-op.
-- 7. MARK-READ REJECTED CROSS-WORKSPACE-HOP: a user cannot UPDATE their own
--    row's workspace_id to another workspace — WITH CHECK re-validates
--    workspace_id = current_workspace_id() on the NEW row.
-- 8. DEACTIVATED USER BLOCKED: a deactivated (is_active = false) user SELECTs
--    and UPDATEs ZERO notifications, even their own.
-- 9. NO DELETE: no role can DELETE a notification through the API — no
--    DELETE policy, RLS default-denies it.
-- 10. select reset_demo_workspace(); as a non-service role -> permission
--     denied (unchanged from 0023/0025).
-- 11. Re-run select reset_demo_workspace(); as postgres/service_role -> any
--     notifications rows created against the demo workspace are gone after
--     the reset; every other row count is unchanged from 0025's baseline (2
--     properties, 4 units, 2 vendors, 3 tickets, 2 tenancies, 0 tenants, 2
--     income, 2 expense, 2 documents, 1 invoice).
-- =============================================================================
