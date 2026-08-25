-- =============================================================================
-- Migration 0032: Betriebskosten U-B — meters, meter readings, measured
--                  consumption basis, and the HeizKG heat/hot-water split
--                  (operator-only; NO tenant-facing RLS in this slice)
-- =============================================================================
-- Adds the U-B slice of the Betriebskosten / Utilities engine (product-deepening
-- plan section 4): sub-metering (meters + meter_readings), unlocks the
-- HEATING/HOT_WATER operating-cost categories that 0031 deliberately withheld,
-- and adds the section-restricted config the HeizKG (Bundesgesetz ueber die
-- Aufteilung von Heiz- und Warmwasserkosten) 55-75% measured-consumption split
-- needs on settlement_allocation_rules. See src/lib/betriebskosten/allocate.ts
-- and src/lib/betriebskosten/consumption.ts for the pure computation this
-- schema feeds, and 0031's header for the U-A core this extends.
--
-- MIGRATION NUMBERING: existing files run 0001-0031. Next free lexical number, 0032.
--
-- LEGAL SPINE (why the schema looks like this):
--   * HeizKG section 4 (Austria): for a centrally heated/hot-watered building,
--     55-75% of heat cost must be billed on MEASURED CONSUMPTION, the remainder
--     on heated usable area. Germany's HeizkostenV section 7 uses 50-70% for the
--     adjacent case. The bound is therefore stored PER RULE (not hard-coded to
--     one jurisdiction), defaulting to the Austrian 55/75 range.
--   * 0031 left `operating_cost_category` WITHOUT 'HEATING'/'HOT_WATER' and
--     `allocation_basis` WITHOUT 'CONSUMPTION' precisely so an operator could
--     never enter a heat cost and have it silently area-split (an unlawful
--     statement that looks correct). This migration adds those enum values —
--     see PART 1 below for why that has to happen, and commit, BEFORE anything
--     in this same file references them — and then makes the addition useless
--     for anything OTHER than the lawful heat-split shape: a
--     settlement_allocation_rules row for category HEATING/HOT_WATER MUST use
--     basis 'CONSUMPTION' and MUST carry a complete heat-split config (PART 4's
--     CHECK constraints). There is no basis value a HEATING/HOT_WATER category
--     can resolve to that skips the split — that IS the structural prevention
--     the roadmap task asks for; src/lib/betriebskosten/allocate.ts enforces
--     the same rule a second time, in the engine, for defence in depth.
--
-- PART 1 — WHY THE EXPLICIT `commit;` BELOW IS NOT OPTIONAL:
--   Postgres allows `alter type ... add value` inside a transaction block
--   (since PG12), but the new value CANNOT be used — compared, cast, or
--   referenced by a CHECK constraint — in the SAME transaction that added it
--   ("unsafe use of new value ... of enum type", a hard error). This file's own
--   later parts DO reference 'HEATING' / 'HOT_WATER' / 'CONSUMPTION' (in CHECK
--   constraints on settlement_allocation_rules). Both of this project's real
--   execution paths run a multi-statement SQL file as ONE implicit transaction
--   unless told otherwise: the Supabase Studio SQL editor (a single simple-
--   query-protocol message), and `supabase/schema_bundle.sql` pasted whole (the
--   ENTIRE bundle, every migration concatenated, is one paste = one implicit
--   transaction). Splitting this work across two migration FILES would not
--   fix that, because both files still end up concatenated into the same
--   bundle paste. The fix that actually works regardless of how this file is
--   run: an explicit `commit;` right after the three `add value` statements,
--   which closes whatever transaction (implicit or explicit) was open and
--   lets every later statement run — and auto-commit — in fresh transactions.
--   A stray `commit;` when nothing is open is a harmless no-op warning, so
--   this is also safe if a future runner already wraps statements individually.
--   Idempotent re-runs are unaffected: every statement after the commit is
--   already individually `if not exists` / `duplicate_object`-guarded, so a
--   retry after a partial failure is safe, which is this schema's standing
--   convention for exactly this reason.
--
-- OPERATOR-ONLY, THIS SLICE: same RLS shape as 0031 (finance-scoped SELECT
-- incl. OPERATOR for read visibility; can_manage_finance() writes). NO
-- tenant-facing SELECT policy is added anywhere in this file.
--
-- HELPER REUSE: set_updated_at (0001), current_workspace_id / current_role
-- (0002), can_manage_finance() (0017) all exist and are REUSED, not redefined.
--
-- RLS is enabled in THIS SAME FILE, immediately after each table is created
-- (the 0001/0002 lesson, restated in 0031).
--
-- [rls] — flagged for prop-rls-reviewer before this is run live (new tables +
-- writes to policies/RLS surface + new CHECK constraints on an existing
-- RLS-bearing table), per roadmap v2 section 2.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PART 1. Enum value additions — MUST be the first statements in this file,
-- and MUST be followed by an explicit commit before anything below uses them.
-- `add value if not exists` makes each one safely re-runnable.
-- -----------------------------------------------------------------------------
alter type public.operating_cost_category add value if not exists 'HEATING';
alter type public.operating_cost_category add value if not exists 'HOT_WATER';
alter type public.allocation_basis add value if not exists 'CONSUMPTION';

commit;

-- =============================================================================
-- PART 2. New enums for meters/readings.
-- =============================================================================
do $do$ begin
  create type public.meter_kind as enum ('HEAT', 'HOT_WATER', 'COLD_WATER', 'ELECTRICITY', 'GAS');
exception when duplicate_object then null; end $do$;

do $do$ begin
  create type public.meter_reading_source as enum ('MANUAL', 'IMPORT');
exception when duplicate_object then null; end $do$;

-- =============================================================================
-- PART 3. meters — attached to a unit (sub-metered) OR to the property only
--          (a common/central meter, e.g. a shared boiler's heat meter).
-- =============================================================================
create table if not exists public.meters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  property_id uuid not null,
  -- NULL = a property/common-area meter (e.g. the central heat meter feeding
  -- the HeizKG split's consumption leg is often one meter per unit, but a
  -- master/check meter at the property is legitimately unit_id IS NULL).
  unit_id uuid,

  kind public.meter_kind not null,
  serial_number text,
  unit_of_measure text not null,          -- display only, e.g. 'kWh', 'm3' — free text, not enumerable across kinds/vendors
  -- CT-style meters (current-transformer, common on electricity meters) read a
  -- SAMPLE, not the true flow — multiplier converts a raw reading delta into
  -- actual consumption: consumption = (current - previous) x multiplier. 1 for
  -- every meter that reads true units directly (the overwhelming majority).
  multiplier numeric not null default 1,

  is_active boolean not null default true,
  installed_at date,
  removed_at date,
  note text,

  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meters_id_workspace_unique unique (id, workspace_id),
  constraint meters_multiplier_positive check (multiplier > 0 and multiplier is not null),
  constraint meters_removed_after_installed
    check (removed_at is null or installed_at is null or removed_at >= installed_at),

  constraint meters_property_fk
    foreign key (property_id, workspace_id)
    references public.properties (id, workspace_id) on delete cascade,
  -- unit_id is nullable, so this composite FK is MATCH SIMPLE (skipped when
  -- unit_id is null) — the 0031 document_id precedent.
  constraint meters_unit_fk
    foreign key (unit_id, workspace_id)
    references public.units (id, workspace_id) on delete cascade
);

create index if not exists meters_workspace_property_idx
  on public.meters (workspace_id, property_id);
create index if not exists meters_workspace_unit_idx
  on public.meters (workspace_id, unit_id) where unit_id is not null;

create trigger meters_set_updated_at
  before update on public.meters
  for each row execute function public.set_updated_at();

-- Data-integrity guard: a unit-attached meter's unit must actually belong to
-- the meter's own property_id — without this, a typo'd unit_id from ANOTHER
-- property would silently fold that property's consumption into THIS one's
-- settlement (the composite FK only proves the unit exists in the same
-- WORKSPACE, not the same PROPERTY). SECURITY DEFINER + pinned search_path,
-- matching every guard trigger in this schema (0031's
-- settlement_cost_position_period_guard is the direct precedent).
create or replace function public.meters_unit_property_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_property uuid;
begin
  if new.unit_id is null then
    return new;
  end if;
  select property_id into v_unit_property
    from public.units
   where id = new.unit_id and workspace_id = new.workspace_id;
  if v_unit_property is null or v_unit_property <> new.property_id then
    raise exception 'meter unit_id % does not belong to property %', new.unit_id, new.property_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists meters_unit_property_guard on public.meters;
create trigger meters_unit_property_guard
  before insert or update on public.meters
  for each row execute function public.meters_unit_property_guard();

alter table public.meters enable row level security;

create policy "meters_select_finance"
  on public.meters for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "meters_insert_finance"
  on public.meters for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "meters_update_finance"
  on public.meters for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "meters_delete_finance"
  on public.meters for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- =============================================================================
-- PART 4. meter_readings — cumulative counter values. consumption over a
--          period = (reading at/before period end - reading at/before period
--          start) x meter.multiplier — computed in
--          src/lib/betriebskosten/consumption.ts, never in SQL.
-- =============================================================================
create table if not exists public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  meter_id uuid not null,

  reading_date date not null,
  value numeric not null,                 -- cumulative counter value; NEVER a delta
  source public.meter_reading_source not null default 'MANUAL',
  note text,

  created_by_user_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint meter_readings_id_workspace_unique unique (id, workspace_id),
  constraint meter_readings_value_nonneg check (value >= 0),
  -- One reading per meter per day — a second same-day reading would make
  -- "the" baseline/current reading for a period ambiguous.
  constraint meter_readings_meter_date_unique unique (workspace_id, meter_id, reading_date),

  constraint meter_readings_meter_fk
    foreign key (meter_id, workspace_id)
    references public.meters (id, workspace_id) on delete cascade
);

create trigger meter_readings_set_updated_at
  before update on public.meter_readings
  for each row execute function public.set_updated_at();

alter table public.meter_readings enable row level security;

create policy "meter_readings_select_finance"
  on public.meter_readings for select
  using (
    (
      workspace_id = public.current_workspace_id()
      and public.current_role() in ('SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT')
    )
    or public.current_role() = 'SUPER_ADMIN'
  );

create policy "meter_readings_insert_finance"
  on public.meter_readings for insert
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "meter_readings_update_finance"
  on public.meter_readings for update
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance())
  with check (workspace_id = public.current_workspace_id() and public.can_manage_finance());

create policy "meter_readings_delete_finance"
  on public.meter_readings for delete
  using (workspace_id = public.current_workspace_id() and public.can_manage_finance());

-- =============================================================================
-- PART 5. settlement_allocation_rules — activate the U-B seam columns 0031
--          already reserved (consumption_split_pct, base_split_basis), and add
--          the configurable HeizKG/HeizkostenV bound (min/max percent).
-- =============================================================================
alter table public.settlement_allocation_rules
  -- Defaults to the AUSTRIAN HeizKG range (55-75%); Germany's HeizkostenV
  -- 50-70% is reachable by an operator explicitly overriding both bounds on a
  -- rule — this is the "configurable per settlement, defaults to Austria"
  -- requirement. Mirrored in TypeScript as
  -- AUSTRIA_HEIZKG_MIN_PERMILLE/MAX_PERMILLE (src/lib/betriebskosten/allocate.ts).
  add column if not exists heat_split_min_pct numeric default 55,
  add column if not exists heat_split_max_pct numeric default 75;

-- Bounds are sane whenever present (both nullable — only meaningful when
-- basis = 'CONSUMPTION', enforced by the constraint below).
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_heat_split_bounds_sane
    check (
      heat_split_min_pct is null or heat_split_max_pct is null
      or (
        heat_split_min_pct >= 0 and heat_split_min_pct <= 100
        and heat_split_max_pct >= 0 and heat_split_max_pct <= 100
        and heat_split_min_pct <= heat_split_max_pct
      )
    );
exception when duplicate_object then null; end $do$;

-- The configured share must actually sit inside its own configured bound.
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_consumption_pct_in_bounds
    check (
      consumption_split_pct is null
      or heat_split_min_pct is null or heat_split_max_pct is null
      or (consumption_split_pct >= heat_split_min_pct and consumption_split_pct <= heat_split_max_pct)
    );
exception when duplicate_object then null; end $do$;

-- STRUCTURAL PREVENTION (the roadmap task's central requirement): a
-- HEATING/HOT_WATER category rule cannot resolve to a plain area/per-unit
-- basis — it MUST be 'CONSUMPTION' (which, combined with the next
-- constraint, forces the full heat-split config to be present too). This is
-- exactly why PART 1's enum commit has to happen first: this CHECK compares
-- the `category` column against the two values just added.
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_heat_category_requires_consumption_basis
    check (category not in ('HEATING', 'HOT_WATER') or basis = 'CONSUMPTION');
exception when duplicate_object then null; end $do$;

-- 'CONSUMPTION' basis (whatever the category — HeizKG heat, or a plain
-- sub-metered category like WATER_SEWER) always needs its own split
-- percentage + bound + a named remainder basis. A rule cannot claim basis =
-- 'CONSUMPTION' and leave any of these null.
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_consumption_basis_requires_fields
    check (
      basis <> 'CONSUMPTION'
      or (
        consumption_split_pct is not null
        and base_split_basis is not null
        and heat_split_min_pct is not null
        and heat_split_max_pct is not null
      )
    );
exception when duplicate_object then null; end $do$;

-- base_split_basis (the remainder leg) is restricted to 'USABLE_AREA' — the
-- only remainder basis this slice's engine implements (PER_UNIT stays
-- deferred for the remainder leg exactly as it is for the main engine; see
-- src/lib/betriebskosten/allocate.ts's module header and
-- src/lib/data/settlements.ts's persistAllocationRun for the U-A precedent of
-- throwing rather than silently mis-computing an unimplemented basis).
do $do$ begin
  alter table public.settlement_allocation_rules
    add constraint settlement_allocation_rules_base_split_basis_supported
    check (base_split_basis is null or base_split_basis = 'USABLE_AREA');
exception when duplicate_object then null; end $do$;

-- =============================================================================
-- PART 6. settlement_unit_allocations (0031) — total_basis_value > 0
--          assumed EVERY basis's denominator is structurally positive
--          whenever a position is not blocked. True for USABLE_AREA (every
--          valid unit has area > 0, enforced by units_usable_area_positive).
--          NOT true for U-B's CONSUMPTION basis: a zero-gross cost position
--          (POSITION_ZERO_AMOUNT, non-blocking in the engine) can legitimately
--          have zero measured consumption too (no meters configured yet, or
--          genuinely nobody used anything that period), and that transparent
--          EUR 0 row still needs to persist. Loosen the constraint to require
--          a positive denominator ONLY when real money is actually being
--          distributed on that row — `drop ... if exists` + re-add is this
--          schema's "redefine a constraint" idiom (constraints, unlike
--          functions, have no `create or replace`).
-- =============================================================================
alter table public.settlement_unit_allocations
  drop constraint if exists settlement_unit_allocations_total_basis_positive;

do $do$ begin
  alter table public.settlement_unit_allocations
    add constraint settlement_unit_allocations_total_basis_positive
    check (total_basis_value > 0 or allocatable_amount = 0);
exception when duplicate_object then null; end $do$;

-- =============================================================================
-- SMOKE TESTS — run these manually once a live Supabase project is connected:
-- =============================================================================
-- 1. A finance manager (SUPER_ADMIN/OWNER/ACCOUNTANT) in workspace X can INSERT,
--    UPDATE, SELECT, DELETE meters/meter_readings belonging to X.
-- 2. ROLE INVERSION — an OPERATOR in X CAN SELECT meters/meter_readings but
--    CANNOT INSERT/UPDATE/DELETE (can_manage_finance() excludes OPERATOR).
-- 3. A TENANT/GUEST/VENDOR in X gets ZERO rows on both tables and cannot
--    write anything.
-- 4. Any user in workspace Y SELECTs ZERO of X's meters/meter_readings
--    (cross-workspace isolation).
-- 5. ADVERSARIAL — cross-workspace INSERT/UPDATE rejected on both tables
--    (WITH CHECK's workspace_id conjunct).
-- 6. ADVERSARIAL — cross-workspace meter_id/property_id/unit_id rejected by
--    the COMPOSITE FKs even though a same-workspace WITH CHECK would pass.
-- 7. meters_unit_property_guard rejects a meter whose unit_id belongs to a
--    DIFFERENT property than the meter's own property_id, even when both
--    belong to the same workspace.
-- 8. A deactivated OWNER/ACCOUNTANT (is_active = false) is rejected on every
--    write (can_manage_finance() is is_active-aware).
-- 9. A settlement_allocation_rules row with category = 'HEATING' (or
--    'HOT_WATER') and basis <> 'CONSUMPTION' is REJECTED by
--    settlement_allocation_rules_heat_category_requires_consumption_basis.
-- 10. A settlement_allocation_rules row with basis = 'CONSUMPTION' and any of
--     consumption_split_pct / base_split_basis / heat_split_min_pct /
--     heat_split_max_pct null is REJECTED.
-- 11. consumption_split_pct = 40 with the default 55/75 bound is REJECTED
--     (outside range); consumption_split_pct = 60 is ACCEPTED; a rule that
--     explicitly sets heat_split_min_pct/max_pct = 50/70 (Germany) and
--     consumption_split_pct = 60 is ACCEPTED (the configurable-bound path).
-- 12. base_split_basis = 'PER_UNIT' is REJECTED (only USABLE_AREA implemented
--     for the remainder leg in this slice).
-- 13. meter_readings: two readings for the same meter on the same
--     reading_date are REJECTED (meter_readings_meter_date_unique); a
--     negative value is REJECTED (meter_readings_value_nonneg) — note a
--     negative CONSUMPTION (current < previous, e.g. a meter rollover or
--     replacement) is NOT a DB-level rejection, since each individual
--     reading value is itself a valid non-negative counter value — that
--     case is caught by src/lib/betriebskosten/consumption.ts at compute
--     time, deliberately (see its module header).
-- 14. A settlement_unit_allocations row with total_basis_value = 0 is
--     REJECTED when allocatable_amount > 0, but ACCEPTED when
--     allocatable_amount = 0 (PART 6's loosened constraint — the
--     transparent EUR 0 row for a zero-gross CONSUMPTION position with no
--     configured meters yet).
-- =============================================================================
