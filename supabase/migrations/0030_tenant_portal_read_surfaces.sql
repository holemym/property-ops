-- =============================================================================
-- Migration 0030: Tenant portal read-surfaces (Phase 1B) — RLS + announcements
-- =============================================================================
-- Closes the read-surface gaps flagged in docs/superpowers/plans/2026-07-19-
-- product-deepening.md §3.1B: a linked tenant (0029 gave them a portal LOGIN) still
-- could not read their OWN lease, documents, or invoices — those tables are
-- role-gated to managers+accountant (0016/0018/0019), which correctly excludes
-- TENANT/GUEST/VENDOR from the workspace ROSTER, but ALSO excludes a tenant from
-- their own single row. This migration adds four ADDITIVE, tightly-scoped tenant
-- SELECT policies (tenancies, documents, invoices, invoice_line_items) plus one new
-- table (announcements, a lightweight manager-composed / tenant-read broadcast).
--
-- TENANT role holds ZERO app-layer permissions (src/lib/auth/permissions.ts —
-- ROLE_PERMISSIONS.TENANT = [], ROLE_PERMISSIONS.GUEST = []). Every guarantee below
-- is enforced ENTIRELY by RLS, not by any permission grant — reachable exactly like
-- the existing /portal "My requests" surface (tickets_select_own, 0011/0013).
--
-- MIGRATION NUMBERING: existing files run 0001-0029. Next free lexical number, 0030.
--
-- HELPER REUSE: current_workspace_id / current_role / current_is_active (0002/0007)
-- are REUSED, not redefined. Two NEW SECURITY DEFINER helpers are added here
-- (current_tenant_id, tenant_can_read_document is a third, and
-- invoice_visible_to_current_tenant a fourth, and tenant_can_read_announcement a
-- fifth) for the same structural reason as user_owns_ticket (0012/0013): a plain
-- inline EXISTS against tenancies/tenants from inside another table's policy would
-- run AS THE CALLER and re-enter tenancies_select_manager_or_accountant (0016) /
-- tenants_select_manager_or_accountant + tenants_select_own (0025/0029) — both of
-- which exclude a bare tenant from rows they do not directly own — so the subquery
-- would silently return zero and the "additive" policy would look like a no-op.
-- SECURITY DEFINER bypasses that inner RLS (runs as the function/table owner),
-- exactly like current_workspace_id() bypassing profiles' own RLS. None of these
-- new helpers gets a `revoke execute from public` — they run INSIDE RLS policies AS
-- the querying (authenticated) role, so EXECUTE must stay grantable to it, matching
-- user_owns_ticket/current_workspace_id (no revoke/grant on read-only definer
-- helpers anywhere in this schema; revoke+grant is reserved for WRITE/RPC functions
-- like reset_demo_workspace/log_ticket_event that must be service-role-only).
--
-- NOT TOUCHED, ANYWHERE IN THIS FILE: tenancies_select_manager_or_accountant
-- (0016), tenants_select_manager_or_accountant/_own (0025/0029),
-- documents_select_manager_or_accountant (0018), invoices_select_finance /
-- invoice_line_items_select_finance (0019), and every INSERT/UPDATE/DELETE policy
-- on any of these tables. This migration is PURELY ADDITIVE new SELECT policies
-- (Postgres ORs multiple permissive policies for the same command — same
-- drop-free reasoning as 0013's tickets_select_own widening precedent) plus one
-- brand-new table. Flagged for prop-rls-reviewer before commit, per roadmap v2 §2.
--
-- RLS is enabled on the NEW table (announcements) in THIS SAME FILE, immediately
-- after it is created (the 0001/0002 lesson: PostgREST auto-exposes every public
-- table the instant it exists).
-- =============================================================================

-- =============================================================================
-- SECTION A — MY HOME: a tenant reads their OWN tenancy/tenancies
-- =============================================================================
-- Gap: tenancies_select_manager_or_accountant (0016:97-103) pins role to
-- SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT, so a TENANT — even the person the lease
-- belongs to — reads ZERO tenancies. units_select_workspace (0009), properties_
-- select_workspace (0003), workspaces_select_own (0002), and profiles_select_self_
-- or_workspace (0002) are ALREADY open within the caller's own workspace, so no new
-- policy is needed for those; only tenancies has the gap.
--
-- current_tenant_id(): mirrors current_workspace_id() (0002) exactly — SQL,
-- STABLE, SECURITY DEFINER, pinned search_path. Resolves the caller's OWN tenants
-- directory row, scoped to their OWN workspace. The tenants_auth_user_unique
-- partial index (0029, on (workspace_id, auth_user_id) WHERE auth_user_id IS NOT
-- NULL) guarantees this scalar subquery returns 0-or-1 row for any given
-- workspace_id — no "more than one row returned by a subquery used as an
-- expression" error. NULL when the caller has no linked tenants row in their
-- current workspace (not a tenant, or a guest/vendor) -> every downstream use
-- fails closed.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.tenants
  where auth_user_id = auth.uid()
    and workspace_id = public.current_workspace_id()
$$;

-- SELECT: a tenant reads ONLY tenancies linked (tenant_id) to their own directory
-- row, in their own workspace. ADDITIVE — 0016's manager/accountant policy is
-- untouched; Postgres ORs the two permissive SELECT policies together.
--
-- Tightness proof (see the migration header for the general SECURITY DEFINER
-- rationale): the workspace_id conjunct on THIS policy plus the workspace_id
-- conjunct INSIDE current_tenant_id() is a double cross-workspace guard, echoing
-- the exact re-invited/moved-profile leak 0029:49-70 documents and guards against.
-- tenant_id IS NULL (a free-text-only tenancy, every pre-P1 row) -> NULL -> row
-- excluded (fail-closed, not an accidental match). current_tenant_id() IS NULL (a
-- guest/vendor/un-invited caller) -> NULL -> excluded (fail-closed, no
-- over-widening). A tenant cannot inflate their own visibility by "planting"
-- tenant_id on some other tenancy: tenancies writes stay manager-only
-- (tenancies_insert_manager / tenancies_update_manager, 0016:110-122, byte-for-byte
-- unchanged) — the link is entirely manager-controlled. A resident with several
-- linked tenancies (current + past + multi-unit) sees ALL of their own, and ZERO of
-- any other tenant's.
create policy "tenancies_select_own_tenant"
  on public.tenancies for select
  using (
    workspace_id = public.current_workspace_id()
    and tenant_id is not null
    and tenant_id = public.current_tenant_id()
  );

-- =============================================================================
-- SECTION B — DOCUMENTS: a tenant reads documents attached to THEIR OWN
-- tenancy / unit / property (lease, certificates, permits)
-- =============================================================================
-- Gap: documents_select_manager_or_accountant (0018:175-183) pins role to
-- SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT, so a TENANT reads ZERO documents,
-- including their own lease.
--
-- WHY A DEDICATED HELPER (not reusing current_tenant_id() alone): a document's
-- entity attribution can be via property_id, unit_id, OR tenancy_id (0018's
-- per-entity nullable-composite-FK model), so the ownership check has to walk
-- tenants -> tenancies -> (optionally) units and match ANY of the three columns —
-- the same "re-enters manager-only RLS" trap documented in the file header, solved
-- the identical way user_owns_ticket (0012, widened 0013:81) solves it for
-- ticket_comments. SECURITY DEFINER bypasses tenants/tenancies/units RLS for this
-- internal join only; the caller's own auth.uid() is still the sole anchor.
create or replace function public.tenant_can_read_document(
  p_property_id uuid, p_unit_id uuid, p_tenancy_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenants t
    join public.tenancies tn
      on tn.tenant_id = t.id and tn.workspace_id = t.workspace_id
    left join public.units u
      on u.id = tn.unit_id and u.workspace_id = tn.workspace_id
    where t.auth_user_id = auth.uid()
      and t.workspace_id = public.current_workspace_id()
      and (
           (p_tenancy_id is not null and p_tenancy_id = tn.id)
        or (p_unit_id    is not null and p_unit_id    = tn.unit_id)
        or (p_property_id is not null and p_property_id = u.property_id)
      )
  )
$$;

-- SELECT: ADDITIVE, OR'd with documents_select_manager_or_accountant (untouched).
-- Fail-closed by construction: current_workspace_id() NULL -> workspace_id = NULL
-- -> excluded; no tenants row for auth.uid() -> exists() false -> excluded;
-- ticket_id-only / vendor_id-only documents match none of the three params ->
-- excluded (tickets have their own portal surface; vendor docs are never a
-- tenant's). The join `tn.tenant_id = t.id` restricts every match to the CALLER'S
-- OWN tenancies, so a tenancy/unit match can never resolve through another
-- tenant's lease.
create policy "documents_select_own_tenant"
  on public.documents for select
  using (
    workspace_id = public.current_workspace_id()
    and public.tenant_can_read_document(property_id, unit_id, tenancy_id)
  );

-- No tenant INSERT/UPDATE/DELETE policy — read-only, unchanged from 0018. No new
-- storage.objects policy either: signing a document's 60s URL for a tenant is done
-- SERVER-SIDE with the service-role client, AFTER this table policy has already
-- scoped the row (src/lib/data/documents.ts's listDocuments, called with the
-- tenant's own RLS-bound client) — see the /portal/documents page (Phase 1B UI,
-- separate deliverable) for the invariant: only ever sign a storage_path that came
-- back from this RLS-scoped read, never a client-supplied path. Adding a tenant
-- storage.objects SELECT policy instead would be unsafe: the documents path
-- (`workspace_id/<uuid>-file`) carries no entity segment to key a per-tenant
-- policy on, so such a policy would let a tenant sign ANY document in the
-- workspace.

-- =============================================================================
-- SECTION C — MY CHARGES: a tenant reads their OWN invoices + line items
-- =============================================================================
-- Gap: invoices_select_finance / invoice_line_items_select_finance (0019:161-165,
-- 196-201) pin role to SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT — deliberately, per
-- 0019's own header ("tenant/owner-portal visibility is a SEPARATE, additive read
-- policy landing with the portal work, NOT opened here"). This is that policy.
--
-- invoice_visible_to_current_tenant(p_invoice_id): takes an invoice's OWN id
-- (either the invoices row's own `id`, or an invoice_line_items row's `invoice_id`
-- foreign key — the SAME helper serves BOTH policies below, so a line item can
-- never outlive its invoice's visibility). SECURITY DEFINER re-reads invoices +
-- tenancies with definer rights (bypassing invoices_select_finance AND
-- tenancies_select_manager_or_accountant), mirroring user_owns_ticket's
-- "look up the parent by id, bypass ITS RLS too" shape (0012/0013). Pins
-- workspace_id = current_workspace_id() (cross-workspace guard), direction =
-- 'OUTBOUND' (an INBOUND vendor bill must never surface as "your charge" even if
-- it happens to carry the tenant's unit/property), status <> 'DRAFT' (a
-- not-yet-issued bill stays invisible — defense in depth alongside the data-layer
-- filter), and tenancy.tenant_id = current_tenant_id() (own-tenancy only; NULL
-- current_tenant_id() for a non-tenant caller fails closed via `= NULL` ->
-- NULL -> not-exists). An invoice with no tenancy_id (owner statements, vendor
-- bills, ad-hoc invoices with no lease link) never joins to any tenancy row, so it
-- is correctly invisible here regardless of who is asking.
create or replace function public.invoice_visible_to_current_tenant(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.invoices inv
    join public.tenancies tn
      on tn.id = inv.tenancy_id
     and tn.workspace_id = inv.workspace_id
    where inv.id = p_invoice_id
      and inv.workspace_id = public.current_workspace_id()
      and inv.direction = 'OUTBOUND'
      and inv.status <> 'DRAFT'
      and tn.tenant_id = public.current_tenant_id()
  )
$$;

-- SELECT — invoices. ADDITIVE; invoices_select_finance (0019) untouched.
create policy "invoices_select_own_tenant"
  on public.invoices for select
  using (public.invoice_visible_to_current_tenant(id));

-- SELECT — invoice_line_items. ADDITIVE; invoice_line_items_select_finance (0019)
-- untouched. Scoped through the SAME helper (by invoice_id) so a line can never be
-- visible when its parent invoice is not — no separate/looser line-item rule.
create policy "invoice_line_items_select_own_tenant"
  on public.invoice_line_items for select
  using (public.invoice_visible_to_current_tenant(invoice_id));

-- No tenant INSERT/UPDATE/DELETE policy on either table — read-only, unchanged
-- from 0019. In-app payment is out of scope (Stripe, Phase 3); this is a read view
-- of the bill + a static "how to pay" note at the UI layer (separate deliverable).

-- =============================================================================
-- SECTION D — ANNOUNCEMENTS: manager-composed, tenant-read building notices
-- =============================================================================
-- New workspace-scoped table. property_id NULL = workspace-wide notice; set =
-- property-targeted (composite FK to properties(id, workspace_id), the same
-- optional-attribution pattern documents' property_id uses, 0018:129-131, anchored
-- on properties_id_workspace_unique, 0009:61).
create type public.announcement_status as enum ('DRAFT', 'PUBLISHED');

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid,                       -- null = workspace-wide; else property-targeted
  title text not null,
  body  text not null,
  status public.announcement_status not null default 'DRAFT',
  published_at timestamptz,               -- stamped on the DRAFT->PUBLISHED transition (app action)
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade
);

-- Feeds the tenant read query (own workspace, PUBLISHED only, newest-published-first)
-- and the manager compose list (a later, separate deliverable).
create index if not exists announcements_workspace_status_idx
  on public.announcements (workspace_id, status, published_at desc);

create trigger announcements_set_updated_at
  before update on public.announcements
  for each row execute function public.set_updated_at();

alter table public.announcements enable row level security;

-- tenant_can_read_announcement(a_workspace_id, a_property_id): a TENANT/GUEST
-- cannot SELECT tenancies (0016) nor another tenant's tenants row (0029 gives only
-- OWN-row read), so an inline EXISTS on tenants/tenancies/units inside the policy
-- would (as with Sections A/B above) silently return zero for a property-targeted
-- row even for a legitimately-targeted tenant. SECURITY DEFINER bypasses that.
create or replace function public.tenant_can_read_announcement(a_workspace_id uuid, a_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    a_workspace_id = public.current_workspace_id()
    and public.current_role() in ('TENANT', 'GUEST')          -- matches isTenantRole, permissions.ts:123-125
    and coalesce(public.current_is_active(), false)            -- deactivated caller reads nothing (0026 precedent)
    and (
      a_property_id is null                                    -- workspace-wide: any active tenant/guest of the ws
      or exists (
        select 1
        from public.tenants t
        join public.tenancies ten on ten.tenant_id = t.id and ten.workspace_id = t.workspace_id
        join public.units u       on u.id = ten.unit_id      and u.workspace_id = ten.workspace_id
        where t.auth_user_id = auth.uid()                      -- the caller's own contact row (0029 chain)
          and t.workspace_id = a_workspace_id
          and u.property_id = a_property_id                     -- property reached via THEIR tenancy's unit
          and ten.start_date <= current_date
          and (ten.end_date is null or ten.end_date >= current_date)  -- ACTIVE tenancy only
      )
    )
$$;

-- Tenant/guest read: PUBLISHED + own-scope only. The core tight-scoping policy —
-- a tenant NEVER sees a DRAFT (status pinned in the policy itself, not just the
-- helper) regardless of workspace/property match.
create policy "announcements_select_published_for_tenant"
  on public.announcements for select
  using (status = 'PUBLISHED' and public.tenant_can_read_announcement(workspace_id, property_id));

-- Manager/accountant + SUPER_ADMIN oversight read (drafts included, to manage) —
-- mirrors tenancies_select_manager_or_accountant (0016:97-103).
create policy "announcements_select_manager_or_accountant"
  on public.announcements for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );

-- Writes: managers only, own workspace — byte-for-byte the tenancies_insert/
-- update_manager shape (0016:110-122).
create policy "announcements_insert_manager"
  on public.announcements for insert
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

create policy "announcements_update_manager"
  on public.announcements for update
  using (workspace_id = public.current_workspace_id() and public.is_workspace_manager())
  with check (workspace_id = public.current_workspace_id() and public.is_workspace_manager());

-- No DELETE policy at all — matches the no-DELETE convention (0016:124, 0025:121).
-- Unpublish = UPDATE status back to DRAFT; rows are removed only by workspace/
-- property cascade. The operator "compose" surface itself (the write-side UI, and
-- any ROLE_PERMISSIONS.announcements:* entry to gate it) is a SEPARATE, out-of-scope
-- deliverable — RLS (is_workspace_manager()) is the real enforcement either way.

-- -----------------------------------------------------------------------------
-- DEMO-RESET EXTENSION: wipe demo-workspace announcements too, so a demo
-- visitor's writes don't survive a reset. `create or replace` re-declares the
-- WHOLE function (Postgres has no ALTER FUNCTION ADD LINE); this body is
-- byte-for-byte the prior (0029-era) version with ONE new delete line added,
-- placed with the other simple/independent-child deletes, before properties —
-- same "children before parents" convention as every prior extension
-- (0025 tenants, 0026 notifications). No seed announcements rows are added, same
-- as those precedents; only the wipe needs to happen.
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
  delete from public.announcements where workspace_id = demo_ws;
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

  insert into public.properties (id, workspace_id, name, address_line1, city, postal_code, country, property_type, status)
  values
    (prop_ring, demo_ws, 'Ringstrasse Residenz', 'Ringstrasse 12', 'Wien', '1010', 'Austria', 'APARTMENT_BUILDING', 'ACTIVE'),
    (prop_mhof, demo_ws, 'Mariahilfer Hof', 'Mariahilfer Strasse 88', 'Wien', '1070', 'Austria', 'MIXED_USE', 'ACTIVE');

  insert into public.units (id, workspace_id, property_id, label, floor, occupancy_type, status)
  values
    (unit_top1, demo_ws, prop_ring, 'Top 1', '1', 'LONG_TERM', 'OCCUPIED'),
    (unit_top2, demo_ws, prop_ring, 'Top 2', '2', 'VACANT', 'VACANT'),
    (unit_shop, demo_ws, prop_mhof, 'Shop EG', '0', 'LONG_TERM', 'OCCUPIED'),
    (unit_buero, demo_ws, prop_mhof, 'Buero 1.OG', '1', 'VACANT', 'VACANT');

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

  insert into public.ticket_events (workspace_id, ticket_id, actor_user_id, actor_type, event_type, created_at)
  values
    (demo_ws, ticket_heat, seed_user, 'USER', 'TICKET_CREATED', now() - interval '3 days'),
    (demo_ws, ticket_heat, seed_user, 'USER', 'VENDOR_ASSIGNED', now() - interval '2 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CREATED', now() - interval '5 days'),
    (demo_ws, ticket_water, seed_user, 'USER', 'TICKET_CLOSED', now() - interval '2 days');

  insert into public.ticket_comments (workspace_id, ticket_id, author_user_id, body, visibility, type)
  values (demo_ws, ticket_heat, seed_user, 'Vendor scheduled for tomorrow morning.', 'PUBLIC', 'MESSAGE');

  insert into public.tenancies (id, workspace_id, unit_id, tenant_name, start_date, end_date, rent_amount, created_by_user_id)
  values
    (tenancy_berger, demo_ws, unit_top1, 'Familie Berger', current_date - interval '18 months', null, 1250, seed_user),
    (tenancy_cafe, demo_ws, unit_shop, 'Cafe Sonne GmbH', current_date - interval '13 months', current_date + interval '45 days', 2400, seed_user);

  insert into public.income_records (workspace_id, unit_id, amount, category, period_start, period_end, notes, created_by_user_id)
  values
    (demo_ws, unit_top1, 1250, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user),
    (demo_ws, unit_shop, 2400, 'RENT', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date, 'Monthly rent', seed_user);

  insert into public.expense_records (workspace_id, property_id, unit_id, ticket_id, amount, category, incurred_on, notes, created_by_user_id)
  values
    (demo_ws, null, unit_top1, ticket_water, 450, 'MAINTENANCE', current_date - 2, 'Plumber invoice — water damage repair', seed_user),
    (demo_ws, prop_mhof, null, null, 180, 'UTILITIES', current_date - 5, 'Common-area electricity', seed_user);

  insert into public.documents (workspace_id, document_type, title, storage_path, file_type, file_size, expires_at, tenancy_id, unit_id, uploaded_by_user_id)
  values
    (demo_ws, 'LEASE', 'Lease - Familie Berger (Top 1)', demo_ws::text || '/demo-lease-top1.pdf', 'application/pdf', 210000, null, tenancy_berger, null, seed_user),
    (demo_ws, 'CERTIFICATE', 'Gas safety certificate - Top 1', demo_ws::text || '/demo-cert-top1.pdf', 'application/pdf', 88000, current_date + 25, null, unit_top1, seed_user);

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
-- SECTION A (tenancies_select_own_tenant):
-- 1. A linked TENANT (tenants.auth_user_id = their uid) SELECTs exactly their OWN
--    tenancy row(s) (tenant_id = their tenants.id) — including past + multi-unit
--    leases, all sharing that one tenant_id.
-- 2. That TENANT SELECTs ZERO of another tenant's tenancy rows in the same
--    workspace.
-- 3. A TENANT in workspace Y whose auth_user_id happens to still be carried by an
--    OLD, unlinked tenancy row in workspace X SELECTs ZERO of X's tenancies —
--    current_tenant_id()'s workspace_id conjunct resolves to Y, not X.
-- 4. A TENANT still CANNOT INSERT/UPDATE/DELETE any tenancy (unchanged, 0016
--    manager-only writes).
-- 5. Manager/accountant SELECT is completely unchanged (0016's policy untouched).
--
-- SECTION B (documents_select_own_tenant):
-- 6. A TENANT sees only documents attached to THEIR OWN lease/unit/property
--    (tenancy_id / unit_id / property_id reached via their own tenancy).
-- 7. That TENANT sees ZERO of another tenant's tenancy-linked document, even in
--    the SAME unit's history.
-- 8. That TENANT sees ZERO ticket-scoped or vendor-scoped documents (tickets have
--    their own portal surface; vendor docs are never a tenant's).
-- 9. A TENANT in a different workspace sees ZERO (workspace_id conjunct).
-- 10. Manager/accountant SELECT is completely unchanged (0018's policy untouched).
--
-- SECTION C (invoices_select_own_tenant / invoice_line_items_select_own_tenant):
-- 11. A TENANT sees only OUTBOUND, non-DRAFT invoices tied to THEIR OWN tenancy,
--     and exactly the line items on those invoices.
-- 12. That TENANT sees ZERO of another tenant's invoices/lines, ZERO INBOUND
--     (vendor-bill) invoices, and ZERO DRAFT invoices even on their own tenancy.
-- 13. An invoice with no tenancy_id (owner statement, ad-hoc, vendor bill) is
--     invisible to every tenant (no tenancy join match).
-- 14. Manager/accountant/operator SELECT is completely unchanged (0019's finance
--     policies untouched); tenants still cannot INSERT/UPDATE/DELETE either table.
--
-- SECTION D (announcements):
-- 15. A workspace-wide (property_id null) PUBLISHED announcement is visible to
--     EVERY active TENANT/GUEST of that workspace.
-- 16. A property-targeted PUBLISHED announcement is visible only to a TENANT/GUEST
--     holding an ACTIVE tenancy in THAT property — zero visibility for a tenant of
--     a different property in the same workspace.
-- 17. A DRAFT announcement is invisible to every TENANT/GUEST regardless of scope
--     (status pinned in the tenant policy itself, not just the helper).
-- 18. A cross-workspace TENANT/GUEST sees ZERO announcements (workspace_id
--     conjunct, both in the tenant policy and inside the helper).
-- 19. A DEACTIVATED tenant/guest (is_active = false) sees ZERO announcements.
-- 20. A VENDOR sees ZERO announcements (current_role() not in ('TENANT','GUEST')).
-- 21. Manager/accountant/SUPER_ADMIN SELECT sees DRAFT + PUBLISHED, own workspace
--     (announcements_select_manager_or_accountant) — unaffected by the tenant
--     policy.
-- 22. A non-manager (including TENANT/GUEST) CANNOT INSERT/UPDATE any
--     announcement; there is no DELETE policy for anyone.
-- 23. select reset_demo_workspace(); as service_role wipes demo-workspace
--     announcements along with everything else; as any other role -> permission
--     denied (unchanged from 0023).
-- =============================================================================
