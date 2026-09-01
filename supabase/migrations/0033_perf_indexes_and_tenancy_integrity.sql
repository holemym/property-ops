-- 0033_perf_indexes_and_tenancy_integrity.sql
--
-- Two concerns, both safe to run on live data and idempotent:
--
--   A. Query-justified indexes. Each one backs a real filter/order already issued by
--      src/lib/data/* (cited per index) — none are speculative. All are plain btree
--      composites led by workspace_id, matching the house pattern.
--
--   B. Tenancy integrity backstops. The app layer (occupancy actions + zod) now
--      rejects end-before-start and overlapping tenancies; these constraints make the
--      DB the backstop, closing the race two concurrent submits could still win.
--      Both adds are wrapped in failure-tolerant DO blocks: if LIVE rows already
--      violate a constraint, the migration NOTICEs and continues instead of aborting
--      — fix the flagged rows, then re-run this file (it is fully re-runnable).
--
-- LOCKING CAVEAT (per RLS review): index builds take table-level locks that block
-- writers for the build, and the EXCLUDE add holds ACCESS EXCLUSIVE on tenancies
-- while it scans+builds (Postgres has no NOT VALID for exclusion constraints).
-- Sub-second at today's row counts; on a future large tenancies table, run in a
-- quiet window. The CHECK is split NOT VALID + VALIDATE so its scan does not hold
-- the exclusive lock.

begin;

-- ---------------------------------------------------------------------------
-- A. Indexes
-- ---------------------------------------------------------------------------

-- tickets filtered by unit: unit hub → listTickets({unitId}) (tickets.ts)
create index if not exists tickets_workspace_unit_idx
  on public.tickets (workspace_id, unit_id);

-- tickets filtered by assigned vendor: vendor detail "Assigned tickets" card
create index if not exists tickets_workspace_vendor_idx
  on public.tickets (workspace_id, assigned_vendor_id);

-- paged invoice inbox: listInvoicesPage orders created_at desc under .range()
create index if not exists invoices_workspace_created_idx
  on public.invoices (workspace_id, created_at desc);

-- owners rollup: listInvoices({partyType:'OWNER'})
create index if not exists invoices_workspace_party_type_idx
  on public.invoices (workspace_id, party_type);

-- unit hub expenses: listExpenseRecords({unitId})
create index if not exists expense_records_workspace_unit_idx
  on public.expense_records (workspace_id, unit_id);

-- property-scoped documents: listDocuments({propertyId})
create index if not exists documents_workspace_property_idx
  on public.documents (workspace_id, property_id);

-- person's tenancy history: listTenanciesForTenant (tenants.ts)
create index if not exists tenancies_workspace_tenant_idx
  on public.tenancies (workspace_id, tenant_id);

-- finance ledger default orderings → index-ordered scans
create index if not exists income_records_workspace_period_idx
  on public.income_records (workspace_id, period_start desc);
create index if not exists expense_records_workspace_incurred_idx
  on public.expense_records (workspace_id, incurred_on desc);

-- ---------------------------------------------------------------------------
-- B. Tenancy integrity
-- ---------------------------------------------------------------------------

-- gist over scalar equality (unit_id with =) needs btree_gist.
create extension if not exists btree_gist;

-- A tenancy's end may not precede its start. NULL end = open-ended (allowed).
-- NOT VALID first (no full-table scan under the exclusive lock), then VALIDATE
-- (SHARE UPDATE EXCLUSIVE only — writers keep flowing during the scan).
do $$ begin
  alter table public.tenancies
    add constraint tenancies_dates_ordered
    check (end_date is null or end_date >= start_date) not valid;
exception
  when duplicate_object then null;  -- already added: idempotent re-run
end $$;

do $$ begin
  alter table public.tenancies validate constraint tenancies_dates_ordered;
exception
  when others then
    raise notice 'tenancies_dates_ordered NOT validated (%). Existing rows likely violate it — fix them, then re-run 0033.', sqlerrm;
end $$;

-- No two tenancies on the same unit may overlap in time. App semantics are closed
-- intervals (end date inclusive), hence '[]'; a NULL end_date is open-ended and
-- overlaps everything after its start. unit_id alone suffices — unit ids are global
-- uuids, so cross-workspace collisions cannot occur.
do $$ begin
  alter table public.tenancies
    add constraint tenancies_no_overlap
    exclude using gist (
      unit_id with =,
      daterange(start_date, end_date, '[]') with &&
    );
exception
  when duplicate_object then null;  -- already added: idempotent re-run
  when others then
    raise notice 'tenancies_no_overlap NOT added (%). Overlapping rows likely exist — fix them, then re-run 0033.', sqlerrm;
end $$;

commit;
