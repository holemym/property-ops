-- =============================================================================
-- Migration 0021: invoices.recipient_email (invoice delivery)
-- =============================================================================
-- Adds an optional recipient email so an invoice can be SENT (emailed) to the party,
-- not just printed. Nullable text; validated as an email in the app. No RLS change — the
-- existing invoices policies (0019) already govern this column. Idempotent.
-- =============================================================================

alter table public.invoices add column if not exists recipient_email text;
