-- =============================================================================
-- Migration 0027: Recurring rent invoices — billing_period + dedupe index (Track P3)
-- =============================================================================
-- Adds `invoices.billing_period` (first day of the billed month; null for every
-- non-rent invoice — owner statements, vendor bills, ad-hoc tenant invoices) and a
-- partial unique index that is the actual dedupe mechanism for "Generate rent":
-- app logic (src/lib/invoices/recurring.ts, the pure planner) checks for an
-- existing (tenancy, month) invoice first for a friendly skip count, but the
-- index is what guarantees a tenancy can never be double-billed for the same
-- month even under concurrent clicks — a 23505 unique-violation on insert is
-- caught by the generate action (P3-2) and counted as skipped, never surfaced as
-- an error. See docs/superpowers/specs/2026-07-12-property-ops-p3-recurring-rent-design.md
-- §1-2.
--
-- MIGRATION NUMBERING: existing files run 0001-0026. Next free lexical number is
-- 0027.
--
-- NO POLICY CHANGES: billing_period is a plain nullable column on `invoices`, so
-- it rides the existing finance-gated RLS policies from 0019
-- (invoices_select_finance / invoices_insert_finance / invoices_update_finance) —
-- Postgres RLS is row-level, not column-level, so no new policy is needed for a
-- new column. The unique index is a constraint, not a security boundary, and
-- needs no RLS entry either. Flagged for prop-rls-reviewer per roadmap v2 §2
-- regardless, since this is an [rls]-tagged task.
--
-- WHY A PARTIAL INDEX: (workspace_id, tenancy_id, billing_period) would collide
-- across every non-recurring invoice (tenancy_id and billing_period both null,
-- or a manually-attributed tenant invoice with billing_period left null) if it
-- weren't scoped down. `where tenancy_id is not null and billing_period is not
-- null` limits the constraint to actual recurring-rent rows; `and status <>
-- 'VOID'` lets a mistake be voided and the month regenerated (the P3-3 verify
-- playbook exercises exactly this: void one + regenerate → recreated).
-- =============================================================================

alter table public.invoices
  add column if not exists billing_period date;

create unique index if not exists invoices_tenancy_period_unique
  on public.invoices (workspace_id, tenancy_id, billing_period)
  where tenancy_id is not null and billing_period is not null and status <> 'VOID';
