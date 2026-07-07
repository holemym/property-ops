-- =============================================================================
-- Migration 0017: Finance-light (income_records + expense_records) + RLS
-- =============================================================================
-- Adds the two finance-light bookkeeping tables that make profit-per-unit
-- computable: `public.income_records` (rent / deposits / fees) and
-- `public.expense_records` (non-ticket maintenance / utilities / tax / etc.).
-- Plus their category enums and a NEW finance-scoped write helper,
-- `public.can_manage_finance()`.
--
-- This migration copies the 0003 properties / 0009 units / 0011 tickets /
-- 0016 tenancies TEMPLATE for the SHARED conventions (fail-closed
-- RLS-in-same-file, EXPLICIT WITH CHECK, SUPER_ADMIN read-only override on
-- writes, no-DELETE, nullable composite-FK / MATCH SIMPLE integrity). Read those
-- headers for the full rationale; only the finance-specific deltas are documented
-- here.
--
-- MIGRATION NUMBERING: existing files are 0001, 0002, 0003, 0006-0016. This is the
-- next free lexical number, 0017 — numbered by apply position, not by a plan task id.
--
-- THE FINANCE ROLE INVERSION (the load-bearing delta vs. every prior domain table):
-- every prior write helper (is_workspace_manager) grants OPERATOR and EXCLUDES
-- ACCOUNTANT — operators run ops, accountants get read-only oversight. Finance is
-- the OPPOSITE: the ACCOUNTANT owns the books and MUST write them, while the
-- OPERATOR runs ops but does NOT keep the books (read-only). So finance writes are
-- gated by a NEW helper `can_manage_finance()` = SUPER_ADMIN / OWNER / ACCOUNTANT
-- (is_active-aware) — NOT is_workspace_manager(). ACCOUNTANT gains its first write
-- permission here. OPERATOR keeps SELECT (they need cost visibility) but is denied
-- INSERT/UPDATE. This inversion is the single most important thing an adversarial
-- reviewer must confirm: do NOT reuse is_workspace_manager() for finance writes.
--
-- SHARED TYPES: `public.entity_status` (0003) is NOT re-created here — finance rows
-- do not use it. The two category enums below (income_category / expense_category)
-- are table-specific and created here for the first time.
--
-- HELPER REUSE: set_updated_at, current_workspace_id, current_role,
-- current_is_active all exist from 0001/0002/0007 and are REUSED, not redefined.
-- can_manage_finance() is defined below (this file's contribution), mirroring the
-- 0008 is_active-aware, SECURITY DEFINER, pinned-search_path helper shape.
--
-- COMPOSITE-FK PREREQUISITES (see 0009/0011 for the full rationale: FK validation
-- checks ROW EXISTENCE and BYPASSES RLS, so a plain `property_id references
-- properties(id)` would let a manager in workspace X plant a finance row referencing
-- workspace Y's property — a cross-workspace dangling reference. The fix is the
-- composite-FK pattern: reference (child_id, workspace_id) as a PAIR against a
-- UNIQUE(id, workspace_id) on the parent). All three parents already carry the
-- required unique constraints and nothing is added here:
--   * properties.properties_id_workspace_unique — added in 0009.
--   * units.units_id_workspace_unique           — added in 0011.
--   * tickets.tickets_id_workspace_unique        — added in 0011 (inline).
-- So the nullable composite FKs below reference existing unique constraints;
-- there are NO prerequisite ALTERs in this file.
--
-- NULLABLE-COMPOSITE-FK / MATCH SIMPLE (same subtlety as tickets.unit_id in 0011):
-- property_id / unit_id / ticket_id are all NULLABLE here. Postgres FKs default to
-- MATCH SIMPLE, under which a multi-column FK is NOT CHECKED AT ALL if ANY of its
-- columns is NULL. Because workspace_id is NOT NULL, the only NULL column in each
-- pair is the child id — i.e. the "not linked to a property/unit/ticket" case — so a
-- NULL child legitimately skips the check. When the child id IS non-NULL, BOTH
-- columns are non-NULL and the pair is checked in full, enforcing that the referenced
-- row belongs to THIS finance row's workspace. on delete set null: deleting the
-- parent detaches the finance row (preserving the ledger entry) rather than deleting
-- it or dangling.
--
-- RLS is enabled in THIS SAME FILE, immediately after each table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it exists,
-- so a table that lives even briefly without RLS is a cross-tenant hole).
-- =============================================================================

create type public.income_category as enum ('RENT', 'DEPOSIT', 'FEE', 'OTHER');
create type public.expense_category as enum (
  'MAINTENANCE', 'UTILITIES', 'TAX', 'INSURANCE', 'MANAGEMENT', 'OTHER'
);

-- -----------------------------------------------------------------------------
-- FINANCE WRITE HELPER — can_manage_finance()
--
-- Mirrors is_workspace_manager() (0008) in EVERY structural respect — SECURITY
-- DEFINER, STABLE, pinned search_path (blocks the object-shadowing escalation
-- vector, since it calls other SECURITY DEFINER helpers), is_active-aware via
-- coalesce(current_is_active(), false) which fails CLOSED for a caller with no
-- profile row — but with the INVERTED role set: it INCLUDES 'ACCOUNTANT' and
-- EXCLUDES 'OPERATOR'. This is deliberate (see THE FINANCE ROLE INVERSION above):
-- the accountant owns the books; the operator does not. Every finance INSERT/UPDATE
-- policy below calls this by name, so a later `create or replace` that further
-- tightens it (e.g. a future audit flag) hardens all finance writes at once.
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role() in ('SUPER_ADMIN', 'OWNER', 'ACCOUNTANT')
     and coalesce(public.current_is_active(), false)
$$;

-- =============================================================================
-- income_records
-- =============================================================================
create table public.income_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  -- property_id / unit_id: OPTIONAL attribution. Income may be booked at the
  -- property, the unit, or neither. NULLABLE composite FKs (MATCH SIMPLE — see the
  -- NULLABLE-COMPOSITE-FK block in the header): NULL child skips the check; a
  -- non-NULL child must belong to THIS row's workspace. on delete set null.
  property_id uuid,
  unit_id uuid,

  amount numeric not null,
  -- currency: text, defaults to 'EUR' (the workspace default). No multi-currency
  -- conversion — YAGNI per the spec; this is a label, not a conversion key.
  currency text not null default 'EUR',
  category public.income_category not null default 'RENT',

  -- period_start / period_end: the accounting period this income covers.
  -- period_start REQUIRED; period_end NULL for a point-in-time / single-day booking.
  period_start date not null,
  period_end date,

  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint income_records_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete set null,

  constraint income_records_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete set null
);

create index income_records_workspace_id_idx on public.income_records (workspace_id);

create trigger income_records_set_updated_at
  before update on public.income_records
  for each row execute function public.set_updated_at();

-- =============================================================================
-- expense_records
-- =============================================================================
-- Same shape as income_records with three deltas: (1) category is expense_category
-- (default 'MAINTENANCE'); (2) a single `incurred_on date not null` replaces the
-- period_start/period_end pair (an expense is incurred on a day, not over a period);
-- (3) an optional `ticket_id` links a manual expense back to the ticket it settles
-- (analytics dedupes ticket-linked expenses against that ticket's actual_cost to
-- avoid double-counting maintenance spend — documented in analytics.ts).
create table public.expense_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,

  property_id uuid,
  unit_id uuid,
  -- ticket_id: OPTIONAL link to the ticket this expense settles. NULLABLE composite
  -- FK (ticket_id, workspace_id) -> tickets(id, workspace_id), MATCH SIMPLE — NULL
  -- skips the check (a non-ticket cost like a utility bill), non-NULL must belong to
  -- this workspace. on delete set null: deleting the ticket detaches the expense
  -- (the ledger entry survives).
  ticket_id uuid,

  amount numeric not null,
  currency text not null default 'EUR',
  category public.expense_category not null default 'MAINTENANCE',

  -- incurred_on: the day the expense was incurred. REQUIRED (replaces income's
  -- period_start/period_end pair).
  incurred_on date not null,

  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expense_records_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id)
    on delete set null,

  constraint expense_records_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id)
    on delete set null,

  constraint expense_records_ticket_fk
    foreign key (ticket_id, workspace_id)
    references public.tickets (id, workspace_id)
    on delete set null
);

create index expense_records_workspace_id_idx on public.expense_records (workspace_id);

create trigger expense_records_set_updated_at
  before update on public.expense_records
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security — IDENTICAL pattern for both tables.
--
-- NULL-safety (same three-valued-logic rationale as 0002/0003/0009/0011/0016): a
-- caller whose current_workspace_id() is NULL matches no rows (`workspace_id = NULL`
-- -> NULL -> excluded), and current_role() is NULL only for a caller with no profile
-- row, which likewise fails every policy closed.
--
-- SELECT — role-gated to SUPER_ADMIN / OWNER / OPERATOR / ACCOUNTANT within the
-- workspace, plus the SUPER_ADMIN platform read-only override. This mirrors the
-- 0011 tickets / 0016 tenancies SELECT (NOT the 0003 open-select): finance rows are
-- not tenant-facing. NOTE the deliberate asymmetry with the write policies below:
-- OPERATOR is INCLUDED in SELECT (they need cost visibility to run ops) but EXCLUDED
-- from writes (they don't keep the books). TENANT / GUEST / VENDOR get ZERO rows.
--
-- INSERT / UPDATE — can_manage_finance() (SUPER_ADMIN / OWNER / ACCOUNTANT, NOT
-- OPERATOR), own workspace only. EXPLICIT WITH CHECK re-validates the NEW row so a
-- workspace-hop (`UPDATE ... SET workspace_id = <other>`) is rejected. No SUPER_ADMIN
-- platform write override (NULL workspace -> three-valued-logic rejection), same as
-- 0003. No DELETE policy (default-deny; void/soft-delete is a later concern).
-- -----------------------------------------------------------------------------

alter table public.income_records enable row level security;

create policy "income_records_select_finance"
  on public.income_records for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "income_records_insert_finance"
  on public.income_records for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "income_records_update_finance"
  on public.income_records for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy — intentional. RLS default-denies any command without a matching
-- policy, so DELETE is closed through the API. Corrections are UPDATEs; voiding is a
-- later concern. Rows are removed only by cascade when their workspace is deleted.

alter table public.expense_records enable row level security;

create policy "expense_records_select_finance"
  on public.expense_records for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "expense_records_insert_finance"
  on public.expense_records for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "expense_records_update_finance"
  on public.expense_records for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy — intentional, same as income_records above.

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected.
-- Apply to BOTH income_records and expense_records (identical RLS).
-- =============================================================================
-- 1. An OWNER in workspace X can INSERT, UPDATE, and SELECT finance rows belonging
--    to X (can_manage_finance() includes OWNER; SELECT includes OWNER).
-- 2. An ACCOUNTANT in X can INSERT, UPDATE, and SELECT X's finance rows — this is
--    the ACCOUNTANT's FIRST write permission (can_manage_finance() INCLUDES
--    ACCOUNTANT, unlike is_workspace_manager() which excludes it). The accountant
--    owns the books.
-- 3. ROLE INVERSION — an OPERATOR in X CAN SELECT X's finance rows (cost visibility)
--    but CANNOT INSERT or UPDATE them: can_manage_finance() EXCLUDES OPERATOR, so the
--    insert WITH CHECK / update USING+WITH CHECK fail. This is the OPPOSITE of every
--    prior domain table (where operator writes and accountant is read-only) and is
--    the single most important assertion to verify.
-- 4. A TENANT / GUEST / VENDOR in X gets ZERO finance rows on SELECT (role-gated, not
--    open-select) and CANNOT INSERT or UPDATE (no matching role in either policy).
--    Full fail-closed isolation.
-- 5. Any user in workspace Y SELECTs ZERO of workspace X's finance rows
--    (cross-workspace tenant isolation — the core guarantee).
-- 6. ADVERSARIAL — cross-workspace INSERT rejected: a finance manager in Y running
--    `INSERT INTO income_records (..., workspace_id) VALUES (..., <X's id>)` is
--    rejected by the insert WITH CHECK (NEW.workspace_id != current_workspace_id()).
-- 7. ADVERSARIAL — workspace-hop UPDATE rejected: a finance manager in X running
--    `UPDATE income_records SET workspace_id = <Y's id> WHERE ...` on a row they own
--    is rejected by the update WITH CHECK.
-- 8. ADVERSARIAL — cross-workspace property_id / unit_id (and ticket_id on
--    expense_records) rejected by the COMPOSITE FK: an INSERT with workspace_id = X
--    and property_id (or unit_id / ticket_id) = <a row owned by Y> is REJECTED by the
--    respective composite FK (no parent row has (Y's id, X) as an (id, workspace_id)
--    pair) — even though the WITH CHECK, which only inspects workspace_id, would have
--    passed. Un-bypassable backstop for the FK-bypasses-RLS gap. A NULL child skips
--    the check (MATCH SIMPLE) and inserts fine (income/expense not attributed).
-- 9. A DEACTIVATED OWNER or ACCOUNTANT in X (is_active = false) is REJECTED on INSERT
--    and UPDATE: can_manage_finance() is is_active-aware (coalesce(...false)), so the
--    WITH CHECK / USING fails. (They retain SELECT until the auth-layer ban lands,
--    same caveat as 0008.)
-- 10. No user (any role) can DELETE a finance row through the API — no DELETE policy,
--     so RLS default-denies it.
-- =============================================================================
