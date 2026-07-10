-- =============================================================================
-- Migration 0023: Demo mode (Track D)
-- =============================================================================
-- A public, self-resetting sandbox workspace. Visitors reach it via anonymous
-- Supabase sessions (app-side: src/app/(auth)/demo-actions.ts), never a shared
-- credential — see that file's header for why. This migration:
--   1. Tags workspaces with is_demo + demo_reset_at.
--   2. Creates ONE synthetic "Demo Seed" identity (auth.users + profiles row) purely
--      for created_by/uploaded_by attribution on seeded rows — it has no usable
--      password, an unroutable email, and is never logged into. Same mechanism
--      Supabase's own seed templates use: insert into auth.users directly and let the
--      existing on_auth_user_created trigger (0001) create the matching profile.
--   3. Creates the demo workspace itself (fixed UUID, so app env config is stable).
--   4. reset_demo_workspace(): SECURITY DEFINER, service-role-only (same lock as
--      log_ticket_event/0012) — wipes every demo-workspace row (children-to-parents FK
--      order) and re-inserts a small but structurally complete seed (one of every
--      major entity type: property, unit, vendor, ticket + event + comment, tenancy,
--      income, expense, document, invoice + line item). Kept intentionally modest
--      (not the full ~30-row live seed) since this SQL cannot be test-executed before
--      the user applies it — smaller and correct beats large and risky.
--   5. Tightens the attachments/documents storage INSERT policies to also deny the
--      demo workspace — belt-and-braces on top of the app-level upload block (S1.5).
--
-- Idempotent throughout; fold into schema_bundle.sql. RLS review: no new policies grant
-- anything — reset_demo_workspace only tightens two existing INSERT policies.
-- =============================================================================

alter table public.workspaces add column if not exists is_demo boolean not null default false;
alter table public.workspaces add column if not exists demo_reset_at timestamptz;

-- -----------------------------------------------------------------------------
-- The demo workspace (fixed UUID — the app reads it from DEMO_WORKSPACE_ID env).
-- Created FIRST: the seed profile below is attached to it, and profiles.workspace_id
-- is an FK to workspaces(id) — the parent row must exist before the attach.
-- -----------------------------------------------------------------------------
insert into public.workspaces (id, name, is_active, is_demo)
values ('11111111-1111-1111-1111-111111111111'::uuid, 'Demo Properties', true, true)
on conflict (id) do update set is_demo = true;

-- -----------------------------------------------------------------------------
-- Synthetic "Demo Seed" identity — attribution only, never a real login.
-- -----------------------------------------------------------------------------
-- Minimal auth.users row (unroutable email, no password hash, unconfirmed) so the
-- existing on_auth_user_created trigger creates a matching public.profiles row.
-- ON CONFLICT DO NOTHING makes the whole block idempotent; the profiles row it
-- creates is left in place on re-run (it's just attached to the demo workspace below).
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-00000000d3d0',
  'authenticated', 'authenticated',
  'demo-seed@property-ops.internal',
  null, null,
  '{"provider":"internal","providers":["internal"]}'::jsonb,
  '{"full_name":"Demo Seed"}'::jsonb,
  now(), now(),
  '', '', '', ''
)
on conflict (id) do nothing;

update public.profiles
set workspace_id = '11111111-1111-1111-1111-111111111111'::uuid,
    role = 'OWNER',
    is_active = true
where id = '00000000-0000-0000-0000-00000000d3d0'::uuid;

-- -----------------------------------------------------------------------------
-- reset_demo_workspace() — wipe + re-seed. SECURITY DEFINER, service_role-only.
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

-- Run the seed once now, so the workspace is populated immediately on apply.
select public.reset_demo_workspace();

-- -----------------------------------------------------------------------------
-- Storage: tighten attachments/documents INSERT policies to also deny the demo
-- workspace — belt-and-braces on top of the app-level upload block (see
-- src/lib/demo.ts). Re-creates the existing policies with one added clause.
-- -----------------------------------------------------------------------------
drop policy if exists "attachments_objects_insert" on storage.objects;
create policy "attachments_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and coalesce(public.current_is_active(), false)
    and not exists (
      select 1 from public.workspaces w
      where w.id = public.current_workspace_id() and w.is_demo
    )
    and (
      public.is_workspace_manager()
      or public.user_owns_ticket(((storage.foldername(name))[2])::uuid)
    )
  );

drop policy if exists "documents_objects_insert" on storage.objects;
create policy "documents_objects_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_workspace_id()::text
    and public.is_workspace_manager()
    and not exists (
      select 1 from public.workspaces w
      where w.id = public.current_workspace_id() and w.is_demo
    )
  );

-- =============================================================================
-- SMOKE TESTS — run these manually once applied:
-- =============================================================================
-- 1. select count(*) from properties where workspace_id = '11111111-1111-1111-1111-111111111111';
--    -> expect 2 (and units=4, vendors=2, tickets=3, tenancies=2, income=2, expense=2,
--    documents=2, invoices=1).
-- 2. select reset_demo_workspace(); as a non-service role -> permission denied.
-- 3. Re-run select reset_demo_workspace(); as postgres -> row counts unchanged (wipe+
--    reseed is idempotent), demo_reset_at advances.
-- 4. Attempt a storage.objects insert into the 'attachments' or 'documents' bucket
--    under the demo workspace's folder, authenticated as the demo workspace's own
--    anonymous user -> denied (not exists clause fails).
-- =============================================================================
