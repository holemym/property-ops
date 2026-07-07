-- =============================================================================
-- APPLY 0019 — Invoices + invoice line items (idempotent).
-- Paste into the Supabase SQL editor and click Run. Safe to re-run: every statement
-- is guarded (do-block enums / create-if-not-exists / drop-policy-if-exists), so a
-- partial or repeat apply is a no-op. This is the same block already folded into
-- supabase/schema_bundle.sql — use that bundle instead if you're rebuilding from empty.
-- Requires migrations 0001–0018 already applied (parent tables + can_manage_finance()).
-- Verify after: select count(*) from pg_tables where schemaname='public';  -- expect 16
-- =============================================================================

do $do$ begin
  create type public.invoice_party_type as enum ('OWNER','TENANT','VENDOR','OTHER');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type public.invoice_direction as enum ('OUTBOUND','INBOUND');
exception when duplicate_object then null; end $do$;
do $do$ begin
  create type public.invoice_status as enum ('DRAFT','SENT','PARTIAL','PAID','OVERDUE','VOID');
exception when duplicate_object then null; end $do$;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_number text not null,
  party_type public.invoice_party_type not null,
  party_name text not null,
  direction public.invoice_direction not null default 'OUTBOUND',
  status public.invoice_status not null default 'DRAFT',
  property_id uuid,
  unit_id uuid,
  tenancy_id uuid,
  vendor_id uuid,
  ticket_id uuid,
  currency text not null default 'EUR',
  tax_rate numeric not null default 0,
  issue_date date not null default current_date,
  due_date date,
  paid_at timestamptz,
  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_number_workspace_unique unique (workspace_id, invoice_number),
  constraint invoices_id_workspace_unique unique (id, workspace_id),
  constraint invoices_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),
  constraint invoices_property_fk foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete set null,
  constraint invoices_unit_fk foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete set null,
  constraint invoices_tenancy_fk foreign key (tenancy_id, workspace_id)
    references public.tenancies (id, workspace_id) on delete set null,
  constraint invoices_vendor_fk foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete set null,
  constraint invoices_ticket_fk foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete set null
);
create index if not exists invoices_workspace_id_idx on public.invoices (workspace_id);
create index if not exists invoices_status_idx on public.invoices (workspace_id, status);
drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null,
  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null,
  amount numeric generated always as (quantity * unit_amount) stored,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint invoice_line_items_quantity_positive check (quantity > 0),
  constraint invoice_line_items_invoice_fk foreign key (invoice_id, workspace_id)
    references public.invoices (id, workspace_id) on delete cascade
);
create index if not exists invoice_line_items_workspace_id_idx on public.invoice_line_items (workspace_id);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);

alter table public.invoices enable row level security;
drop policy if exists "invoices_select_finance" on public.invoices;
create policy "invoices_select_finance" on public.invoices for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );
drop policy if exists "invoices_insert_finance" on public.invoices;
create policy "invoices_insert_finance" on public.invoices for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());
drop policy if exists "invoices_update_finance" on public.invoices;
create policy "invoices_update_finance" on public.invoices for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.invoice_line_items enable row level security;
drop policy if exists "invoice_line_items_select_finance" on public.invoice_line_items;
create policy "invoice_line_items_select_finance" on public.invoice_line_items for select
  using (
    (workspace_id = public.current_workspace_id()
       and public.current_role() in ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT'))
    or public.current_role() = 'SUPER_ADMIN'
  );
drop policy if exists "invoice_line_items_insert_finance" on public.invoice_line_items;
create policy "invoice_line_items_insert_finance" on public.invoice_line_items for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());
drop policy if exists "invoice_line_items_update_finance" on public.invoice_line_items;
create policy "invoice_line_items_update_finance" on public.invoice_line_items for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());
drop policy if exists "invoice_line_items_delete_finance" on public.invoice_line_items;
create policy "invoice_line_items_delete_finance" on public.invoice_line_items for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());
