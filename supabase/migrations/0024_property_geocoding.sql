-- =============================================================================
-- Migration 0024: properties.latitude / longitude / geocoded_at (Track M map view)
-- =============================================================================
-- Adds three nullable columns to public.properties so a property's address can be
-- geocoded once (via Nominatim, see src/lib/geocode.ts) and plotted as a pin on the
-- /map page (Track M). Purely additive and idempotent — safe to re-run.
--
-- latitude / longitude: double precision, nullable. NULL means "not geocoded yet"
-- (Nominatim never returned a match, or geocoding hasn't run) — the /map page counts
-- these and offers a manager-only backfill action for them. The app always writes
-- both together, never just one (see src/lib/geocode-service.ts).
-- geocoded_at: timestamptz, nullable. Stamped on a SUCCESSFUL geocode only; nulled
-- together with latitude/longitude whenever a re-geocode fails after an address edit —
-- a stale pin at the OLD address is worse than no pin (spec's explicit call).
--
-- RLS: NO POLICY CHANGE. These columns ride the existing properties_select_workspace /
-- properties_insert_manager / properties_update_manager policies from migration 0003 —
-- SELECT stays workspace-membership-gated, INSERT/UPDATE stays is_workspace_manager()-
-- gated, exactly like every other column on this table (name, address_line1, etc.).
-- Geocoding doesn't need a narrower or wider audience than the property row itself
-- already has, so there is no new policy to author. Flagged [rls] per the roadmap's
-- standing rule for any migration touching a table with RLS — this is the formality
-- review the rule asks for, not a live behavior change.
--
-- Privacy note (see the Track M spec): the only data that ever leaves the app for this
-- feature is the property's own address text, sent once to Nominatim per create/update/
-- backfill. No tenant, finance, ticket, or document data is involved.
-- =============================================================================

alter table public.properties
  add column if not exists latitude    double precision,
  add column if not exists longitude   double precision,
  add column if not exists geocoded_at timestamptz;

-- =============================================================================
-- SMOKE TESTS — run these manually once applied:
-- =============================================================================
-- 1. `select column_name, data_type from information_schema.columns
--     where table_name = 'properties' and column_name in
--     ('latitude','longitude','geocoded_at');` -> 3 rows (double precision, double
--     precision, timestamp with time zone).
-- 2. An existing property row has all three columns NULL immediately after this runs —
--    no automatic backfill happens (Track M's backfill action is opt-in, manager-only).
-- 3. A manager (OWNER/OPERATOR/SUPER_ADMIN) can UPDATE a property's latitude/longitude/
--    geocoded_at under the SAME properties_update_manager policy as any other column —
--    no new grant needed. An ACCOUNTANT still cannot (matches properties:write, which
--    excludes ACCOUNTANT in src/lib/auth/permissions.ts).
-- 4. Re-running this migration is a no-op (add column if not exists guards).
-- =============================================================================
