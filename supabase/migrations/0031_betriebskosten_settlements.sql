-- =============================================================================
-- Migration 0031: Betriebskosten U-A — Austrian annual operating-cost settlement
--                  core (operator-only; NO tenant-facing RLS in this slice)
-- =============================================================================
-- Adds the U-A slice of the Betriebskosten / Utilities engine (product-deepening
-- plan §4, docs/superpowers/plans/2026-07-19-product-deepening.md:130-132):
-- Austria's annual §21 MRG operating-cost statement, §17 MRG default distribution
-- key (Nutzflaeche/usable-area proportional), no meters/consumption (U-B) and no
-- advance-payment reconciliation (U-C) yet. Four new tables (settlement_periods,
-- settlement_cost_positions, settlement_allocation_rules,
-- settlement_unit_allocations), one new column on `units`, and three new enums.
--
-- MIGRATION NUMBERING: existing files run 0001-0030. Next free lexical number, 0031.
--
-- LEGAL SPINE (why the schema looks like this):
--   * MRG section 21 EXHAUSTIVELY lists which operating costs may be passed
--     through to tenants. `operating_cost_category` encodes that catalog as a
--     Postgres enum with DELIBERATELY NO 'OTHER' member — an escape hatch would
--     defeat the entire compliance point (a non-passable cost, e.g. a repair or a
--     lawyer's invoice, must be un-enterable, not re-labelled).
--   * MRG section 17 default distribution key: a unit's share = (unit usable area
--     / total usable area of the property's units) x allocatable cost, after
--     deducting a configured owner/common portion. `units.usable_area_m2` is the
--     Nutzflaeche input; `public.allocation_basis` names the key.
--   * HeizKG (heat/hot water, 55-75% consumption-based) is OUT OF SCOPE here —
--     `HEATING`/`HOT_WATER` are deliberately ABSENT from the category enum, so an
--     operator cannot enter a heat cost and have it silently area-split (which
--     would be an unlawful statement that looks correct). U-B adds those values.
--
-- OPERATOR-ONLY, THIS SLICE: RLS below is the 0019 invoices SHAPE (finance-scoped
-- SELECT incl. OPERATOR for cost visibility; can_manage_finance() writes, i.e. the
-- FINANCE ROLE INVERSION — ACCOUNTANT writes, OPERATOR read-only), NOT the 0016
-- tenancies shape. NO tenant-facing SELECT policy is added anywhere in this file —
-- that is U-C's job (an additive policy routed through a dedicated SECURITY
-- DEFINER helper, per the 0030 precedent — see the header note at the bottom).
--
-- HELPER REUSE: set_updated_at (0001), current_workspace_id / current_role
-- (0002), can_manage_finance() (0017) all exist and are REUSED, not redefined.
--
-- COMPOSITE-FK PREREQUISITE: `documents` does not yet carry unique(id,
-- workspace_id) (properties/units/vendors/tickets/tenancies/invoices/tenants all
-- do). Added here, additively, via the DO-block/duplicate_object guard shape from
-- 0018_documents.sql:71-72, because settlement_cost_positions.document_id needs it
-- for its (nullable) composite FK.
--
-- RLS is enabled in THIS SAME FILE, immediately after each table is created (the
-- 0001/0002 lesson: PostgREST auto-exposes every public table the instant it
-- exists, so a table that lives even briefly without RLS is a cross-tenant hole).
--
-- [rls] — flagged for prop-rls-reviewer before this is run live (new tables +
-- writes to policies/RLS surface), per roadmap v2 section 2.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. PREREQUISITE: documents needs unique(id, workspace_id) for the (document_id,
--    workspace_id) composite FK on settlement_cost_positions. Additive and safe
--    (id is already the PK, so the pair is trivially unique). Guarded so a re-run
--    (constraint already present) is a no-op.
-- -----------------------------------------------------------------------------
do $do$ begin
  alter table public.documents
    add constraint documents_id_workspace_unique unique (id, workspace_id);
exception when duplicate_object or duplicate_table then null; end $do$;

-- -----------------------------------------------------------------------------
-- 1. units.usable_area_m2 — Nutzflaeche (MRG section 17 key).
--
-- A NEW column, NOT a reuse of units.size_m2 (0009_units.sql:70): size_m2 is an
-- untyped, freely-operator-entered "size" of unknown provenance (gross vs. usable
-- unclear); Nutzflaeche is a LEGALLY DEFINED measure (excludes balconies,
-- terraces, generally cellars/attics/stairwells/common areas). A
-- coalesce(usable_area_m2, size_m2) fallback would silently produce a WRONG
-- section 17 denominator that reconciles to itself and is therefore
-- undetectable — the single most dangerous shortcut available in this slice.
-- Two columns, one legal meaning each. NULL = "not yet surveyed", NEVER
-- "excluded from the key" — the allocator (src/lib/betriebskosten/allocate.ts)
-- refuses to run at all when any unit of the property has a null/invalid area,
-- rather than silently excluding it (which would overcharge the remaining
-- tenants — the exact legal harm this engine exists to prevent).
--
-- RLS: none — the column rides the existing units_select_workspace /
-- units_insert_manager / units_update_manager policies (0009_units.sql), the
-- same reasoning 0024_property_geocoding.sql gives for lat/long. This means the
-- column is readable by TENANT/GUEST/VENDOR sessions via PostgREST (units SELECT
-- is open-select on workspace membership only) — acceptable (Nutzflaeche is in
-- the lease; size_m2 already has this exposure) but named explicitly.
-- -----------------------------------------------------------------------------
alter table public.units
  add column if not exists usable_area_m2 numeric;

do $do$ begin
  alter table public.units
    add constraint units_usable_area_positive
    check (usable_area_m2 is null or usable_area_m2 > 0);
exception when duplicate_object or duplicate_table then null; end $do$;

-- Feeds the pre-run validation "which units of this property still lack a
-- Nutzflaeche" (a partial index, same idiom as 0027_recurring_rent.sql).
create index if not exists units_missing_usable_area_idx
  on public.units (workspace_id, property_id)
  where usable_area_m2 is null;

-- -----------------------------------------------------------------------------
-- 2. ENUMS
-- -----------------------------------------------------------------------------

-- The compliance constraint. MRG section 21 (Abs 1 Z1-8 + oeffentliche Abgaben),
-- section 22 (Verwaltungskosten), section 23 (Hausbetreuung), section 24
-- (Gemeinschaftsanlagen). DELIBERATELY NO 'OTHER' MEMBER — see the file header.
do $do$ begin
  create type public.operating_cost_category as enum (
    'WATER_SEWER',              -- Wasserversorgung / Abwasser, incl. meter rent + reading
    'DRAIN_CLEANING',           -- Kanalraeumung
    'WASTE_DISPOSAL',           -- Muell- / Unratabfuhr
    'PEST_CONTROL',             -- Schaedlingsbekaempfung
    'CHIMNEY_SWEEP',            -- Rauchfangkehrung
    'COMMON_ELECTRICITY',       -- Beleuchtung / Strom allgemeine Teile
    'INSURANCE_FIRE',           -- Feuerversicherung
    'INSURANCE_LIABILITY',      -- Haftpflichtversicherung
    'INSURANCE_WATER_DAMAGE',   -- Leitungswasserschadenversicherung
    'INSURANCE_OTHER',          -- Glasbruch / Sturmschaden (needs tenant-majority consent)
    'PUBLIC_CHARGES',           -- oeffentliche Abgaben (Grundsteuer)
    'MANAGEMENT_FEE',           -- section 22 Verwaltungshonorar (statutory per-m2 cap)
    'CARETAKER',                -- section 23 Hausbesorger / Hausbetreuung
    'CLEANING',                 -- Hausreinigung (where not via Hausbesorger)
    'SNOW_REMOVAL',             -- Schneeraeumung
    'GARDEN_MAINTENANCE',       -- Gartenbetreuung (garden as a common part)
    'ELEVATOR',                 -- section 24 Aufzug (Gemeinschaftsanlage)
    'COMMON_FACILITY_OTHER'     -- section 24 other: laundry, playground, SAT/antenna
  );
exception when duplicate_object then null; end $do$;

-- U-A implements exactly what it can compute with U-A data: USABLE_AREA (section
-- 17 default key) and PER_UNIT (equal split — legitimate for some section 24
-- Gemeinschaftsanlagen by agreement). CONSUMPTION / HEATED_AREA are added in U-B
-- via `alter type ... add value` in a LATER migration (never in the same
-- transaction as code that references them — see the migration's own risk notes).
do $do$ begin
  create type public.allocation_basis as enum ('USABLE_AREA', 'PER_UNIT');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.settlement_status as enum ('DRAFT', 'ALLOCATED', 'FINALIZED', 'VOID');
exception when duplicate_object then null; end $do$;

-- =============================================================================
-- 3. settlement_periods — the per-property annual period
-- =============================================================================
create table if not exists public.settlement_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,

  label text not null,                        -- "Betriebskosten 2026"
  period_start date not null,
  period_end   date not null,
  currency text not null default 'EUR',       -- one currency per statement; NOT per position

  status public.settlement_status not null default 'DRAFT',
  -- MRG section 21 Abs 3: the statement must be laid open by 30 June of the
  -- following year. Plain nullable date set by the APP (never enforced by the
  -- DB) — not a generated column, to avoid the immutability trap on
  -- extract()/make_date() inside a stored generated expression.
  disclosure_deadline date,
  finalized_at timestamptz,
  finalized_by_user_id uuid references public.profiles (id),

  notes text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Anchor so the three children below can composite-FK back (0019 precedent).
  constraint settlement_periods_id_workspace_unique unique (id, workspace_id),
  constraint settlement_periods_property_range_unique
    unique (workspace_id, property_id, period_start, period_end),

  -- <= 366 days rather than a hard calendar-year check: a mid-year acquisition
  -- produces a legitimate short first period. The "should be a calendar year"
  -- nudge belongs in the app, not the DB.
  constraint settlement_periods_range_valid
    check (period_end > period_start and period_end - period_start <= 366),

  constraint settlement_periods_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade
);

create index if not exists settlement_periods_workspace_property_idx
  on public.settlement_periods (workspace_id, property_id, period_start desc);
create index if not exists settlement_periods_workspace_status_idx
  on public.settlement_periods (workspace_id, status);

create trigger settlement_periods_set_updated_at
  before update on public.settlement_periods
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 4. settlement_cost_positions — the master-bill line items
-- =============================================================================
create table if not exists public.settlement_cost_positions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,

  category public.operating_cost_category not null,
  amount numeric not null,                    -- gross, in the period's currency
  -- Abflussprinzip: a cost belongs to the year it was PAID. Trigger-validated
  -- (below) against the parent period's bounds.
  paid_on date not null,
  -- Informational only (an insurance policy year rarely matches the settlement year).
  service_period_start date,
  service_period_end   date,

  supplier_name text,
  description text,                           -- "Wiener Wasser Jahresrechnung 2026"
  note text,

  -- Belegeinsicht (MRG section 21 Abs 3 gives tenants a statutory right to
  -- inspect receipts). Nullable composite FK, MATCH SIMPLE — NULL skips the check.
  document_id uuid,

  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint settlement_cost_positions_amount_nonneg check (amount >= 0),
  constraint settlement_cost_positions_service_range
    check (service_period_end is null or service_period_start is null
           or service_period_end >= service_period_start),

  -- settlement_period_id is NOT NULL, so the composite FK is ALWAYS checked (no
  -- MATCH SIMPLE skip) — a position always belongs to a same-workspace period.
  constraint settlement_cost_positions_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade,
  constraint settlement_cost_positions_document_fk
    foreign key (document_id, workspace_id)
    references public.documents (id, workspace_id) on delete set null
);

-- No uniqueness on (period, category) — a year legitimately has several water bills.
-- Covers both the per-period list and the per-category rollup (prefix match).
create index if not exists settlement_cost_positions_period_category_idx
  on public.settlement_cost_positions (workspace_id, settlement_period_id, category);

create trigger settlement_cost_positions_set_updated_at
  before update on public.settlement_cost_positions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. settlement_allocation_rules — basis + owner/common deduction
-- =============================================================================
-- Grain: ONE default rule per period (category IS NULL), plus optional
-- per-category overrides (category IS NOT NULL) — same NULL-means-broader-scope
-- idiom as documents.property_id / announcements.property_id.
create table if not exists public.settlement_allocation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,

  category public.operating_cost_category,     -- NULL = period default rule
  basis public.allocation_basis not null default 'USABLE_AREA',
  -- The owner/common portion withheld before allocation (e.g. a commercial
  -- ground floor billed separately, or a contractually agreed owner share).
  owner_deduction_pct numeric not null default 0,

  -- U-B SEAMS — nullable, unused and unwritten in U-A:
  consumption_split_pct numeric,               -- HeizKG 55-75% on measured consumption
  base_split_basis public.allocation_basis,    -- basis for the remainder (heated area)

  note text,
  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint settlement_allocation_rules_owner_pct_range
    check (owner_deduction_pct >= 0 and owner_deduction_pct <= 100),
  constraint settlement_allocation_rules_consumption_pct_range
    check (consumption_split_pct is null
           or (consumption_split_pct >= 0 and consumption_split_pct <= 100)),

  constraint settlement_allocation_rules_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade
);

-- A plain UNIQUE(ws, period, category) would NOT stop two NULL-category rows
-- (NULLs are distinct). Two partial unique indexes (0027 idiom) rather than
-- PG15+ `NULLS NOT DISTINCT`.
create unique index if not exists settlement_allocation_rules_default_unique
  on public.settlement_allocation_rules (workspace_id, settlement_period_id)
  where category is null;
create unique index if not exists settlement_allocation_rules_category_unique
  on public.settlement_allocation_rules (workspace_id, settlement_period_id, category)
  where category is not null;

create trigger settlement_allocation_rules_set_updated_at
  before update on public.settlement_allocation_rules
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 6. settlement_unit_allocations — the per-unit result
-- =============================================================================
-- Grain: (period, unit, category) — not (period, unit). One number per unit is
-- not a TRANSPARENT breakdown; the statement must show, per section 21 line,
-- gross -> minus owner% -> allocatable -> x share% -> amount. Per-category grain
-- is also what makes a future mixed-basis case representable (water on
-- CONSUMPTION while insurance stays on USABLE_AREA in U-B) — impossible at unit
-- grain.
create table if not exists public.settlement_unit_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  settlement_period_id uuid not null,
  unit_id uuid not null,
  category public.operating_cost_category not null,

  -- SNAPSHOT of every input, taken at run time. Nutzflaechen get corrected and
  -- rules get edited; a finalized statement must stay reproducible from its own row.
  basis public.allocation_basis not null,
  category_gross_amount numeric not null,     -- sum of cost positions in this category
  owner_deduction_pct numeric not null default 0,
  allocatable_amount numeric not null,        -- gross x (1 - deduction/100)
  unit_basis_value numeric not null,          -- unit Nutzflaeche (or 1 for PER_UNIT)
  total_basis_value numeric not null,         -- sum over ALL units of the property
  share_pct numeric generated always as (
    case when total_basis_value = 0 then 0
         else unit_basis_value / total_basis_value * 100 end
  ) stored,
  -- NOT generated: the app writes this with largest-remainder rounding so the
  -- unit shares sum exactly to allocatable_amount (src/lib/betriebskosten/allocate.ts).
  amount numeric not null,

  computed_at timestamptz not null default now(),
  computed_by_user_id uuid not null references public.profiles (id),

  constraint settlement_unit_allocations_id_workspace_unique unique (id, workspace_id),
  constraint settlement_unit_allocations_grain_unique
    unique (workspace_id, settlement_period_id, unit_id, category),

  constraint settlement_unit_allocations_total_basis_positive
    check (total_basis_value > 0),
  constraint settlement_unit_allocations_unit_basis_nonneg
    check (unit_basis_value >= 0),
  constraint settlement_unit_allocations_owner_pct_range
    check (owner_deduction_pct >= 0 and owner_deduction_pct <= 100),

  constraint settlement_unit_allocations_period_fk
    foreign key (settlement_period_id, workspace_id)
    references public.settlement_periods (id, workspace_id) on delete cascade,
  constraint settlement_unit_allocations_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade
);

-- Serves the U-C portal read ("my unit's allocations across periods").
create index if not exists settlement_unit_allocations_workspace_unit_idx
  on public.settlement_unit_allocations (workspace_id, unit_id);

-- No `tenancy_id` column — DELIBERATE. The Austrian result is per UNIT; who pays
-- is a separate question (U-C's job — a unit with two tenancies in one year
-- needs the charge pro-rated by days, which would break the grain UNIQUE above).
-- Vacant units get rows too: the denominator is every unit of the property, and
-- a vacant unit's share falls to the OWNER, never redistributed to tenants
-- (Leerstand geht zu Lasten des Vermieters) — the likeliest correctness bug this
-- schema/engine guards against.

-- =============================================================================
-- 7. Finalization lock — trigger guards
-- =============================================================================
-- Modelled on ticket_events_prevent_mutation() / auth_events_prevent_mutation()
-- (the established immutability-guard pattern). SECURITY DEFINER + pinned
-- search_path, matching every helper in this schema — a plain function would
-- read settlement_periods under the CALLER's RLS, which happens to work for a
-- finance manager today but would silently become a no-op if a future policy
-- change ever narrowed SELECT; definer removes that class of failure.
create or replace function public.settlement_period_is_locked(p_period_id uuid, p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.settlement_periods
    where id = p_period_id and workspace_id = p_workspace_id
      and status in ('FINALIZED', 'VOID')
  )
$$;

-- RLS-review finding (0031, cross-workspace lens): this helper is SECURITY DEFINER
-- and is NOT referenced from any USING/WITH CHECK clause -- its only caller is the
-- settlement_child_lock_guard() trigger below. Without an explicit revoke it keeps
-- Postgres's default PUBLIC EXECUTE grant, so PostgREST auto-exposes it as
-- rpc/settlement_period_is_locked, callable by anon/authenticated. Because it is
-- SECURITY DEFINER it bypasses RLS, so any caller supplying a (period_id,
-- workspace_id) pair from ANOTHER workspace could learn whether that period is
-- FINALIZED/VOID -- a cross-workspace authorization leak. Same revoke+grant pair as
-- log_ticket_event (0012), check_rate_limit (0022) and reset_demo_workspace (0023).
-- The trigger's internal call is unaffected: function-to-function calls are checked
-- against the definer/owner's privileges, not PUBLIC's. (The two trigger-returning
-- guards below need no revoke -- Postgres refuses to execute a `returns trigger`
-- function outside trigger context and PostgREST does not expose them as RPC, which
-- is why set_updated_at() and friends carry none either.)
revoke execute on function public.settlement_period_is_locked(uuid, uuid) from public;
grant execute on function public.settlement_period_is_locked(uuid, uuid) to service_role;

-- Applied to all THREE children (cost positions, rules, allocations): once a
-- period is FINALIZED or VOID, none of its children can be inserted, updated, or
-- deleted, by ANY role including service_role (a plain trigger, not RLS, so
-- there is no service_role bypass).
create or replace function public.settlement_child_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period uuid;
  v_ws uuid;
begin
  v_period := coalesce(new.settlement_period_id, old.settlement_period_id);
  v_ws     := coalesce(new.workspace_id, old.workspace_id);
  if public.settlement_period_is_locked(v_period, v_ws) then
    raise exception 'settlement period is finalized: % on % is not permitted', tg_op, tg_table_name
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists settlement_cost_positions_lock_guard on public.settlement_cost_positions;
create trigger settlement_cost_positions_lock_guard
  before insert or update or delete on public.settlement_cost_positions
  for each row execute function public.settlement_child_lock_guard();

drop trigger if exists settlement_allocation_rules_lock_guard on public.settlement_allocation_rules;
create trigger settlement_allocation_rules_lock_guard
  before insert or update or delete on public.settlement_allocation_rules
  for each row execute function public.settlement_child_lock_guard();

drop trigger if exists settlement_unit_allocations_lock_guard on public.settlement_unit_allocations;
create trigger settlement_unit_allocations_lock_guard
  before insert or update or delete on public.settlement_unit_allocations
  for each row execute function public.settlement_child_lock_guard();

-- Abflussprinzip: paid_on must fall inside the parent period (cost positions
-- only). The error message explains the cash-flow principle, not just a range
-- violation — a bill paid in January 2027 for December 2026 service belongs to
-- the 2027 statement, which will surprise an operator expecting the opposite.
create or replace function public.settlement_cost_position_period_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
begin
  select period_start, period_end into v_start, v_end
    from public.settlement_periods
   where id = new.settlement_period_id and workspace_id = new.workspace_id;
  if v_start is not null and (new.paid_on < v_start or new.paid_on > v_end) then
    raise exception 'paid_on % is outside the settlement period % .. % (Abflussprinzip: a cost belongs to the year it was PAID)',
      new.paid_on, v_start, v_end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists settlement_cost_positions_period_guard on public.settlement_cost_positions;
create trigger settlement_cost_positions_period_guard
  before insert or update on public.settlement_cost_positions
  for each row execute function public.settlement_cost_position_period_guard();

-- =============================================================================
-- 8. Row Level Security — finance-scoped (operator read, finance write), NO
--    tenant-facing policy anywhere in this file (that is U-C's job — see the
--    note at the bottom of this section).
-- =============================================================================
-- Boundary choice: can_manage_finance() for writes, four-role SELECT — the 0019
-- invoices SHAPE, not the 0016 tenancies shape. A Betriebskostenabrechnung is a
-- books artifact the ACCOUNTANT must be able to author (same finance role
-- inversion as expense_records/invoices); OPERATOR keeps read-only cost
-- visibility. can_manage_finance() (0017) is REUSED, not redefined.

alter table public.settlement_periods enable row level security;

create policy "settlement_periods_select_finance"
  on public.settlement_periods for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "settlement_periods_insert_finance"
  on public.settlement_periods for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_periods_update_finance"
  on public.settlement_periods for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No DELETE policy — a period is VOIDed (status), never deleted, same as
-- invoices (0019). Rows are removed only by workspace/property cascade.

alter table public.settlement_cost_positions enable row level security;

create policy "settlement_cost_positions_select_finance"
  on public.settlement_cost_positions for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "settlement_cost_positions_insert_finance"
  on public.settlement_cost_positions for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_cost_positions_update_finance"
  on public.settlement_cost_positions for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- DELETE — this table (and the two below) IS editable content, unlike the
-- period: a mistyped supplier bill must be removable (exactly the
-- invoice_line_items_delete_finance argument, 0019). The lock guard (section 7)
-- blocks this once the parent period is FINALIZED, independent of RLS.
create policy "settlement_cost_positions_delete_finance"
  on public.settlement_cost_positions for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.settlement_allocation_rules enable row level security;

create policy "settlement_allocation_rules_select_finance"
  on public.settlement_allocation_rules for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "settlement_allocation_rules_insert_finance"
  on public.settlement_allocation_rules for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_allocation_rules_update_finance"
  on public.settlement_allocation_rules for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_allocation_rules_delete_finance"
  on public.settlement_allocation_rules for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

alter table public.settlement_unit_allocations enable row level security;

create policy "settlement_unit_allocations_select_finance"
  on public.settlement_unit_allocations for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "settlement_unit_allocations_insert_finance"
  on public.settlement_unit_allocations for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_unit_allocations_update_finance"
  on public.settlement_unit_allocations for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "settlement_unit_allocations_delete_finance"
  on public.settlement_unit_allocations for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- No SUPER_ADMIN write override anywhere: a SUPER_ADMIN has workspace_id = NULL,
-- so `workspace_id = current_workspace_id()` -> NULL -> three-valued-logic
-- rejection on every write policy above. Platform reach is READ-ONLY oversight.
--
-- NO TENANT POLICY IN THIS SLICE, AND THE U-C SEAM IS SPECIFIED, NOT LEFT OPEN:
-- U-C adds ADDITIVE `*_select_own_tenant` policies (leaving these untouched, the
-- 0030 discipline) and MUST route through a SECURITY DEFINER helper — e.g.
-- `public.settlement_visible_to_current_tenant(p_period_id uuid, p_unit_id uuid)`
-- modelled on `tenant_can_read_announcement` (0030) — never an inline EXISTS
-- against tenancies/units from inside this file's policies (a bare tenant cannot
-- SELECT tenancies/tenants directly, so an inline subquery would silently return
-- zero rows and the "additive" policy would look like a no-op — the exact trap
-- 0030's header documents for tenancies/documents/invoices).

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A finance manager (SUPER_ADMIN/OWNER/ACCOUNTANT) in workspace X can INSERT,
--    UPDATE, SELECT settlement_periods/settlement_cost_positions/
--    settlement_allocation_rules/settlement_unit_allocations belonging to X, and
--    can DELETE cost positions/rules/allocations (but not periods — no DELETE
--    policy on that table).
-- 2. ROLE INVERSION — an OPERATOR in X CAN SELECT all four tables (cost
--    visibility) but CANNOT INSERT/UPDATE/DELETE any of them
--    (can_manage_finance() excludes OPERATOR).
-- 3. A TENANT/GUEST/VENDOR in X gets ZERO rows on all four tables (no matching
--    role in any SELECT policy) and cannot write anything. Full fail-closed
--    isolation — deliberate for this slice (U-C adds the tenant read surface).
-- 4. Any user in workspace Y SELECTs ZERO of X's rows on all four tables
--    (cross-workspace tenant isolation).
-- 5. ADVERSARIAL — cross-workspace INSERT rejected on all four tables (WITH
--    CHECK's workspace_id conjunct).
-- 6. ADVERSARIAL — workspace-hop UPDATE rejected on all four tables (explicit
--    WITH CHECK re-validates the NEW row).
-- 7. ADVERSARIAL — cross-workspace settlement_period_id / unit_id / document_id
--    rejected by the COMPOSITE FKs even though the WITH CHECK (which only
--    inspects workspace_id) would pass.
-- 8. A DEACTIVATED OWNER/ACCOUNTANT (is_active = false) is REJECTED on every
--    write (can_manage_finance() is is_active-aware).
-- 9. FINALIZATION LOCK — once a period's status is FINALIZED (or VOID), INSERT/
--    UPDATE/DELETE on any of its cost positions/rules/allocations is rejected by
--    the trigger for EVERY role, including service_role (this is a trigger, not
--    RLS — there is no bypass).
-- 10. ABFLUSSPRINZIP — a cost position with paid_on outside [period_start,
--     period_end] is rejected by settlement_cost_position_period_guard on
--     INSERT and UPDATE.
-- 11. share_pct cannot be set directly (GENERATED column) and always equals
--     unit_basis_value / total_basis_value * 100 (or 0 when total_basis_value
--     would be 0 — guarded twice: the CASE inside the generated expression AND
--     the settlement_unit_allocations_total_basis_positive check constraint).
-- 12. units.usable_area_m2: any workspace member (including TENANT/GUEST/VENDOR)
--     can SELECT it via the existing units_select_workspace policy (open-select
--     on membership only) — same exposure size_m2 already has. Only managers/
--     accountant can write it (units_insert_manager/units_update_manager).
-- =============================================================================
