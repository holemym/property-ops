-- =============================================================================
-- Migration 0019: Invoices + invoice line items + RLS
-- =============================================================================
-- Adds a FLEXIBLE invoicing model that covers every Phase-4 case with one schema:
-- owner statements, tenant rent invoices, and inbound vendor/repair bills. The party
-- being invoiced is a DISCRIMINATOR (`invoice_party_type`) rather than three bespoke
-- tables, and `invoice_direction` distinguishes OUTBOUND (we bill an owner/tenant)
-- from INBOUND (a vendor bills us). A header row (`public.invoices`) carries the party,
-- dates, status, currency and a single tax rate; `public.invoice_line_items` holds the
-- billed lines, with a GENERATED `amount` so quantity × unit price can never drift.
--
-- This migration follows the 0017 finance TEMPLATE exactly — read that header for the
-- full rationale on the SHARED conventions. The load-bearing points repeated here:
--
--  * FINANCE ROLE INVERSION: writes are gated by public.can_manage_finance()
--    (SUPER_ADMIN / OWNER / ACCOUNTANT — the accountant owns the books), NOT
--    is_workspace_manager(). OPERATOR keeps SELECT (cost visibility) but is denied
--    INSERT/UPDATE/DELETE. can_manage_finance() already exists (0017); it is REUSED.
--
--  * COMPOSITE-FK / MATCH SIMPLE: property_id / unit_id / tenancy_id / vendor_id /
--    ticket_id are all NULLABLE composite FKs referencing (child_id, workspace_id)
--    against each parent's UNIQUE(id, workspace_id) (all five already exist —
--    properties/units/tickets 0009/0011, vendors 0011, tenancies 0018). A NULL child
--    skips the check; a non-NULL child MUST belong to this invoice's workspace. This is
--    the un-bypassable backstop for the FK-validation-bypasses-RLS gap.
--
--  * RLS enabled in THIS file, immediately after each table (a table that lives even
--    briefly without RLS is a cross-tenant hole via PostgREST auto-exposure).
--
-- TWO DELTAS vs. the finance ledger tables (0017):
--  1. invoices carries invoices_id_workspace_unique UNIQUE(id, workspace_id) so the
--     line-items child can composite-FK back to it (same self-reference trick tickets
--     use for ticket_events). Line items cascade-delete with their invoice.
--  2. invoice_line_items DO get a DELETE policy (gated by can_manage_finance()). Unlike
--     a ledger row, a line item is editable invoice CONTENT — editing an invoice means
--     replacing its lines — so DELETE is a first-class, finance-gated operation here.
--     invoices themselves keep the no-DELETE rule: an invoice is voided (status VOID),
--     never deleted, preserving the numbered record.
--
-- INVOICE NUMBERING: invoice_number is set by the APP on create (INV-YYYY-#### per
-- workspace) and protected by UNIQUE(workspace_id, invoice_number). The app computes the
-- next number from the count and retries once on the (rare) concurrent-insert conflict;
-- the unique constraint is the correctness backstop. No DB sequence/function is added.
-- =============================================================================

create type public.invoice_party_type as enum ('OWNER', 'TENANT', 'VENDOR', 'OTHER');
create type public.invoice_direction as enum ('OUTBOUND', 'INBOUND');
create type public.invoice_status as enum ('DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID');

-- =============================================================================
-- invoices — the header row
-- =============================================================================
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- invoice_number: human-facing, unique WITHIN the workspace (see UNIQUE below).
  -- Assigned by the app on create; NOT NULL.
  invoice_number text not null,

  -- WHO is being invoiced. party_type is the discriminator; party_name is the
  -- denormalized display name (an owner may not be a system user, a vendor's name may
  -- differ from its contact, etc.), always shown on the invoice.
  party_type public.invoice_party_type not null,
  party_name text not null,

  -- OUTBOUND = we bill the party (owner/tenant). INBOUND = the party bills us (vendor).
  direction public.invoice_direction not null default 'OUTBOUND',
  status public.invoice_status not null default 'DRAFT',

  -- OPTIONAL attribution — any subset may be linked. All five are NULLABLE composite FKs
  -- (MATCH SIMPLE): NULL child skips the check; non-NULL child must belong to THIS
  -- invoice's workspace. on delete set null detaches the invoice, preserving the record.
  property_id uuid,
  unit_id uuid,
  tenancy_id uuid,
  vendor_id uuid,
  ticket_id uuid,

  currency text not null default 'EUR',
  -- Single tax rate as a percentage (0..100); total = subtotal × (1 + tax_rate/100),
  -- computed in the app from the line items. No per-line tax — YAGNI for MVP.
  tax_rate numeric not null default 0,

  issue_date date not null default current_date,
  due_date date,
  -- paid_at: stamped when status enters PAID (app-side, mirroring resolved_at/closed_at
  -- on tickets). NULL until paid.
  paid_at timestamptz,

  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_number_workspace_unique unique (workspace_id, invoice_number),
  constraint invoices_id_workspace_unique unique (id, workspace_id),

  constraint invoices_tax_rate_range check (tax_rate >= 0 and tax_rate <= 100),

  constraint invoices_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete set null,
  constraint invoices_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete set null,
  constraint invoices_tenancy_fk
    foreign key (tenancy_id, workspace_id)
    references public.tenancies (id, workspace_id) on delete set null,
  constraint invoices_vendor_fk
    foreign key (vendor_id, workspace_id)
    references public.vendors (id, workspace_id) on delete set null,
  constraint invoices_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id) on delete set null
);

create index invoices_workspace_id_idx on public.invoices (workspace_id);
create index invoices_status_idx on public.invoices (workspace_id, status);

create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

-- =============================================================================
-- invoice_line_items — the billed lines
-- =============================================================================
create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- invoice_id: NOT NULL composite FK (invoice_id, workspace_id) -> invoices(id,
  -- workspace_id). on delete cascade: a line item cannot outlive its invoice, and this
  -- also blocks re-parenting a line to a different workspace's invoice (the pair must
  -- match). Because invoice_id is NOT NULL, the pair is ALWAYS checked (no MATCH SIMPLE
  -- skip) — a line always belongs to a same-workspace invoice.
  invoice_id uuid not null,

  description text not null,
  quantity numeric not null default 1,
  unit_amount numeric not null,
  -- amount is DERIVED and stored — quantity × unit price can never drift from the line.
  amount numeric generated always as (quantity * unit_amount) stored,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),

  constraint invoice_line_items_quantity_positive check (quantity > 0),

  constraint invoice_line_items_invoice_fk
    foreign key (invoice_id, workspace_id)
    references public.invoices (id, workspace_id) on delete cascade
);

create index invoice_line_items_workspace_id_idx on public.invoice_line_items (workspace_id);
create index invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);

-- -----------------------------------------------------------------------------
-- Row Level Security — invoices
--
-- SELECT: SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT within the workspace, plus the
-- SUPER_ADMIN platform read-only override. OPERATOR is INCLUDED in SELECT (cost
-- visibility) but EXCLUDED from writes (the finance inversion). TENANT / GUEST / VENDOR
-- get ZERO rows — tenant/owner-portal visibility is a SEPARATE, additive read policy
-- landing with the portal work, NOT opened here.
--
-- INSERT / UPDATE: can_manage_finance() (SUPER_ADMIN / OWNER / ACCOUNTANT), own
-- workspace only, EXPLICIT WITH CHECK re-validating the NEW row (blocks a workspace-hop
-- UPDATE). No DELETE policy — invoices are voided (status VOID), never deleted.
-- -----------------------------------------------------------------------------
alter table public.invoices enable row level security;

create policy "invoices_select_finance"
  on public.invoices for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "invoices_insert_finance"
  on public.invoices for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "invoices_update_finance"
  on public.invoices for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy — intentional (void via status). Rows removed only by workspace cascade.

-- -----------------------------------------------------------------------------
-- Row Level Security — invoice_line_items
--
-- SELECT mirrors invoices (a reader who can see the invoice can see its lines). Writes
-- are can_manage_finance()-gated on the LINE's own workspace_id. Unlike the ledger
-- tables, line items GET a DELETE policy — editing an invoice replaces its lines, so
-- DELETE is a normal finance-gated operation. (The parent invoice still can't be
-- deleted; only its lines can, and only by a finance manager in the same workspace.)
--
-- Defense-in-depth note: a line's workspace_id is validated against current_workspace_id
-- directly here; the composite FK additionally pins the line to a same-workspace invoice,
-- so a finance manager cannot attach a line to another workspace's invoice even though
-- the WITH CHECK (which only inspects the line's own workspace_id) would pass.
-- -----------------------------------------------------------------------------
alter table public.invoice_line_items enable row level security;

create policy "invoice_line_items_select_finance"
  on public.invoice_line_items for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "invoice_line_items_insert_finance"
  on public.invoice_line_items for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "invoice_line_items_update_finance"
  on public.invoice_line_items for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "invoice_line_items_delete_finance"
  on public.invoice_line_items for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- =============================================================================
-- SMOKE TESTS — run manually once a live Supabase project is connected.
-- =============================================================================
-- 1. An OWNER or ACCOUNTANT in workspace X can INSERT / UPDATE / SELECT X's invoices and
--    line items (can_manage_finance() includes both; SELECT includes both).
-- 2. ROLE INVERSION — an OPERATOR in X CAN SELECT X's invoices + lines (cost visibility)
--    but CANNOT INSERT / UPDATE invoices, nor INSERT / UPDATE / DELETE line items.
-- 3. A TENANT / GUEST / VENDOR in X gets ZERO invoices and ZERO line items on SELECT and
--    cannot write anything (no matching role in any policy). Full fail-closed isolation.
-- 4. Any user in workspace Y SELECTs ZERO of X's invoices / line items (cross-workspace).
-- 5. ADVERSARIAL — cross-workspace INSERT rejected: a finance manager in Y inserting an
--    invoice (or line) with workspace_id = X is rejected by the insert WITH CHECK.
-- 6. ADVERSARIAL — workspace-hop UPDATE rejected by the update WITH CHECK on both tables.
-- 7. ADVERSARIAL — cross-workspace attribution rejected by the COMPOSITE FKs: an invoice
--    INSERT with workspace_id = X and property_id / unit_id / tenancy_id / vendor_id /
--    ticket_id owned by Y is REJECTED (no parent has (Y's id, X) as its (id, workspace)
--    pair), even though the WITH CHECK would pass. NULL children skip the check.
-- 8. ADVERSARIAL — a line item cannot be attached to another workspace's invoice: the
--    invoice_line_items_invoice_fk composite FK requires (invoice_id, workspace_id) to
--    match a real invoice, so a line with workspace_id = X and invoice_id owned by Y is
--    rejected.
-- 9. A DEACTIVATED OWNER / ACCOUNTANT (is_active = false) is REJECTED on all writes
--    (can_manage_finance() is is_active-aware).
-- 10. invoice_number uniqueness: two invoices in the same workspace cannot share a
--     number (invoices_number_workspace_unique); the same number in a DIFFERENT
--     workspace is allowed.
-- 11. Deleting an invoice cascade-deletes its line items; a line item cannot be inserted
--     for a non-existent / cross-workspace invoice (composite FK).
-- 12. amount is GENERATED: it always equals quantity × unit_amount and cannot be set
--     directly. quantity must be > 0 (check constraint).
-- =============================================================================
