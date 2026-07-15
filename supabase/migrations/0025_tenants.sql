-- =============================================================================
-- Migration 0025: Tenant directory (`public.tenants`) + Row Level Security
-- =============================================================================
-- Adds `public.tenants` — a workspace's directory of tenant CONTACT records,
-- distinct from `tenancies` (a time-ranged occupancy/lease record). A tenant is a
-- PERSON; a tenancy is a LEASE. This migration follows the 0016 tenancies file as
-- the TEMPLATE (same PII posture, same fail-closed RLS-in-same-file discipline,
-- same SUPER_ADMIN platform read-only override, same no-DELETE stance) — read
-- 0016's header for the shared rationale; only the tenants-specific deltas are
-- documented here.
--
-- MIGRATION NUMBERING: existing files run 0001-0024. This is the next free
-- lexical number, 0025 — numbered by apply position.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role, and
-- is_workspace_manager all exist from 0001/0002/0008 and are REUSED, not
-- redefined. As of 0008, is_workspace_manager() is is_active-aware, so a
-- deactivated manager is blocked from the INSERT/UPDATE policies below with no
-- change to this file.
--
-- PII POSTURE (identical to tenancies/0016): tenants carries full_name/email/phone
-- — a rental roster of real people. SELECT is role-gated to manager+accountant
-- (SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT), NOT open-select, so TENANT/GUEST/
-- VENDOR sessions cannot read the directory even though they are real workspace
-- members. INSERT/UPDATE are is_workspace_manager() (excludes ACCOUNTANT ->
-- read-only, matching occupancy:read/tenancies). No DELETE — directory entries are
-- history-bearing (a tenant may be referenced by past tenancies via
-- tenancies.tenant_id, and the record should survive even after every linked
-- tenancy has ended).
--
-- LINK FROM TENANCIES: tenancies.tenant_id is an OPTIONAL composite FK to
-- (id, workspace_id) on this new table, `on delete set null`. tenant_id is NULL
-- for every pre-P1 tenancy and stays optional going forward — tenancies.tenant_name
-- REMAINS the display fallback and the record for tenancies with no linked person;
-- when tenant_id IS set, the UI shows the linked tenant's current name instead
-- (P1-3 wires this up; this migration only adds the column + constraint).
-- `tenants_id_workspace_unique` is the composite-FK anchor this requires, matching
-- the properties(0009)/units+vendors+tickets(0011)/tenancies(0018) precedent.
--
-- DEMO-RESET EXTENSION: reset_demo_workspace() (0023) is extended via
-- `create or replace` (Postgres has no ALTER FUNCTION ADD LINE — the whole body is
-- re-declared) to also wipe demo-workspace tenants rows, so a demo visitor's
-- directory writes get reset along with everything else. This is the one
-- policy-adjacent touch beyond the new table/policies — flagged for RLS review
-- along with the rest of this migration.
--
-- RLS is enabled in THIS SAME FILE, immediately after the table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it
-- exists, so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  -- BCP-47-ish language tag (e.g. 'de', 'en'); nullable, unconstrained (no enum —
  -- see spec §5 out-of-scope). Unused until P4 (German i18n); captured now so
  -- directory entries created today don't need a later backfill.
  language text,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Composite-FK anchor: lets tenancies.tenant_id reference (id, workspace_id) as a
  -- pair (see COMPOSITE-FK INTEGRITY precedent in 0009/0011/0016/0018).
  constraint tenants_id_workspace_unique unique (id, workspace_id)
);

create index tenants_workspace_id_idx on public.tenants (workspace_id);

-- Trigram indexes for the /people directory search and the future global-search
-- source (P1-3 adds tenants to searchWorkspace). Reuses the pg_trgm extension
-- already enabled by 0020 — no `create extension` needed here.
create index tenants_full_name_trgm on public.tenants using gin (full_name gin_trgm_ops);
create index tenants_email_trgm on public.tenants using gin (email gin_trgm_ops);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003/0009/0016): a caller
-- whose current_workspace_id() is NULL matches no rows (`workspace_id = NULL` ->
-- NULL -> excluded), and current_role() is NULL only for a caller with no profile
-- row, which likewise fails every policy closed.
-- -----------------------------------------------------------------------------

alter table public.tenants enable row level security;

-- SELECT: ROLE-GATED, NOT open-select — identical posture to
-- tenancies_select_manager_or_accountant (0016). Manager+accountant only, plus the
-- SUPER_ADMIN platform read-only override. TENANT/GUEST/VENDOR get ZERO rows even
-- within their own workspace — the core PII guarantee.
create policy "tenants_select_manager_or_accountant"
  on public.tenants for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- INSERT: managers only (is_workspace_manager() excludes ACCOUNTANT -> read-only),
-- own workspace only. No SUPER_ADMIN platform override on writes (a SUPER_ADMIN
-- has workspace_id = NULL, so `workspace_id = current_workspace_id()` -> NULL ->
-- rejected; platform reach is read-only oversight, matching 0016).
create policy "tenants_insert_manager"
  on public.tenants for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- UPDATE: managers only, own workspace. EXPLICIT WITH CHECK (re-validates the NEW
-- row, so a workspace-hop UPDATE is rejected) — matches 0016's spelled-out pattern.
create policy "tenants_update_manager"
  on public.tenants for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy — intentional, same as 0003/0009/0016. RLS default-denies any
-- command without a matching policy, so DELETE is closed through the API. Directory
-- entries are history-bearing; there is no soft-delete flag in v1 (see spec §5).

-- -----------------------------------------------------------------------------
-- Link from tenancies: OPTIONAL composite FK to (id, workspace_id) on tenants.
-- MATCH SIMPLE (the Postgres default — no explicit keyword needed): a NULL
-- tenant_id skips the check entirely (a tenancy with only free-text tenant_name,
-- the pre-P1 / no-link case, stays valid); a non-NULL tenant_id forces the
-- referenced tenants row to belong to THIS tenancy's workspace — the same
-- un-bypassable-backstop pattern as every other composite FK in this codebase
-- (0009/0011/0016/0017/0018). No dedicated index on tenancies.tenant_id: MVP data
-- volumes (see 0020's rationale), and matches the precedent set by documents'
-- optional entity-link columns (0018), which also carry no per-column index beyond
-- the table's own workspace_id index.
-- -----------------------------------------------------------------------------
alter table public.tenancies add column if not exists tenant_id uuid;

alter table public.tenancies
  add constraint tenancies_tenant_fk
  foreign key (tenant_id, workspace_id)
  references public.tenants (id, workspace_id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- Demo-reset extension: wipe demo-workspace tenants rows too, so a demo visitor's
-- directory writes don't survive a reset. `create or replace` re-declares the
-- WHOLE function (Postgres has no ALTER FUNCTION ADD LINE); this body is
-- byte-for-byte the 0023 original with ONE new delete line added — placed with the
-- other children-before-parents deletes, right after tenancies (tenancies.tenant_id
-- references tenants, so deleting the child row first is the safe order, same
-- convention as the rest of this function). No seed tenants rows are added — the
-- spec calls this "unaffected" otherwise; only the wipe needs to happen.
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
-- 1. A manager (OWNER / OPERATOR / SUPER_ADMIN-with-membership) in workspace X can
--    INSERT, UPDATE, and SELECT tenants belonging to X.
-- 2. An ACCOUNTANT in X can SELECT X's tenants (tenants:read oversight) but CANNOT
--    INSERT or UPDATE them (is_workspace_manager() excludes ACCOUNTANT) —
--    read-only, matching tenants:read without tenants:write.
-- 3. An OPERATOR in X can SELECT AND write (INSERT/UPDATE) X's tenants
--    (is_workspace_manager() includes OPERATOR).
-- 4. PII ISOLATION — a TENANT / GUEST / VENDOR in X SELECTs ZERO tenants, even
--    though they are real workspace members (same guarantee as tenancies/0016).
-- 5. Any user in workspace Y SELECTs ZERO of workspace X's tenants (cross-workspace
--    isolation).
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a manager in Y running
--    `INSERT INTO tenants (..., workspace_id) VALUES (..., <workspace X's id>)` is
--    rejected by tenants_insert_manager's WITH CHECK (NEW.workspace_id !=
--    current_workspace_id()) — no cross-workspace row planting.
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a manager in X running
--    `UPDATE tenants SET workspace_id = <Y's id> WHERE ...` on a row they own is
--    rejected by tenants_update_manager's WITH CHECK.
-- 8. ADVERSARIAL — cross-workspace tenant_id link rejected by the COMPOSITE FK: a
--    manager in X running
--    `INSERT INTO tenancies (workspace_id, unit_id, tenant_id, tenant_name,
--     start_date, ...) VALUES (<X's id>, <a unit in X>, <a tenant owned by
--     workspace Y>, 'Jane Doe', '2026-01-01', ...)`
--    is REJECTED by tenancies_tenant_fk — no tenants row has (Y's tenant id, X) as
--    an (id, workspace_id) pair, so the FK fails existence even though the
--    tenancy's own WITH CHECK (which only inspects the tenancy's workspace_id)
--    would have passed. This is the un-bypassable backstop for the
--    FK-bypasses-RLS gap.
-- 9. A deactivated manager in X (is_active = false) is REJECTED on tenants INSERT
--    and UPDATE: 0008 made is_workspace_manager() is_active-aware, and these
--    policies call it by name, so the block takes effect with no change to this file.
-- 10. No user (any role) can DELETE a tenant through the API — no DELETE policy, so
--     RLS default-denies it.
-- 11. A tenancy can still be created/updated with ONLY tenant_name (tenant_id left
--     NULL) — the composite FK's MATCH SIMPLE default skips the check when
--     tenant_id is NULL, so pre-P1-shaped writes keep working unchanged.
-- 12. select reset_demo_workspace(); as a non-service role -> permission denied
--     (unchanged from 0023).
-- 13. Re-run select reset_demo_workspace(); as postgres/service_role -> any tenants
--     rows a demo visitor created are gone after the reset; every other row count
--     is unchanged from 0023's baseline (2 properties, 4 units, 2 vendors, 3
--     tickets, 2 tenancies, 2 income, 2 expense, 2 documents, 1 invoice).
-- =============================================================================
