-- =============================================================================
-- Migration 0020: Search + hot-path performance indexes
-- =============================================================================
-- Two kinds of index, both purely additive (no schema/RLS change):
--
--  1. TRIGRAM GIN indexes for the global command-palette search. The search runs
--     `col ILIKE '%q%'` across the searchable text columns; a plain btree can't serve a
--     leading-wildcard LIKE, so those scans are sequential. pg_trgm + a GIN trigram index
--     make substring ILIKE fast. (Search works without these — just slower — so this can
--     be applied any time.)
--
--  2. COMPOSITE BTREE indexes for the hottest list query — the paginated ticket inbox,
--     which filters by workspace and orders by created_at (and often filters by status).
--     Every prior table already carries a workspace_id index; these add the
--     workspace_id + sort/filter composites the paged query benefits from.
--
-- Fully idempotent (create ... if not exists): safe to paste into the Supabase SQL editor
-- and safe to re-run. On a large table, prefer CREATE INDEX CONCURRENTLY (not shown here —
-- it can't run inside a transaction block); for MVP data volumes a plain create is fine.
-- =============================================================================

create extension if not exists pg_trgm;

-- --- Trigram indexes (substring ILIKE search) --------------------------------
create index if not exists properties_name_trgm on public.properties using gin (name gin_trgm_ops);
create index if not exists properties_address_trgm on public.properties using gin (address_line1 gin_trgm_ops);
create index if not exists properties_city_trgm on public.properties using gin (city gin_trgm_ops);
create index if not exists units_label_trgm on public.units using gin (label gin_trgm_ops);
create index if not exists tickets_title_trgm on public.tickets using gin (title gin_trgm_ops);
create index if not exists vendors_company_trgm on public.vendors using gin (company_name gin_trgm_ops);
create index if not exists vendors_contact_trgm on public.vendors using gin (contact_name gin_trgm_ops);
create index if not exists vendors_email_trgm on public.vendors using gin (email gin_trgm_ops);
create index if not exists tenancies_tenant_name_trgm on public.tenancies using gin (tenant_name gin_trgm_ops);
create index if not exists invoices_number_trgm on public.invoices using gin (invoice_number gin_trgm_ops);
create index if not exists invoices_party_name_trgm on public.invoices using gin (party_name gin_trgm_ops);
create index if not exists documents_title_trgm on public.documents using gin (title gin_trgm_ops);

-- --- Hot-path composites (paginated ticket inbox) ----------------------------
-- The default paged list is `where workspace_id = ? order by created_at desc`.
create index if not exists tickets_workspace_created_idx
  on public.tickets (workspace_id, created_at desc);
-- Status filter + the dashboard status tally.
create index if not exists tickets_workspace_status_idx
  on public.tickets (workspace_id, status);
