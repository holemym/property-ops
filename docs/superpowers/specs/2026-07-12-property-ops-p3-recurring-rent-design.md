# P3 — Recurring rent invoices — Design

**Date:** 2026-07-12 · **Status:** approved (Fable design pass) · Replaces the
`[plan]` placeholder; board tasks P3-1..P3-3.

Turns finance-light into a rent-collection workflow **without a cron**: a
finance-writer clicks "Generate rent" for a month, the system drafts one invoice per
qualifying tenancy, dedupes idempotently, and humans review-then-send. Overdue
becomes visible.

## 1. Data — migration 0027 `[rls review required]`

One additive column + one partial unique index (no policy changes — columns ride
0019's finance-gated invoice policies):

```
alter table public.invoices
  add column if not exists billing_period date;   -- first day of the billed month; null = not a recurring-rent invoice

create unique index if not exists invoices_tenancy_period_unique
  on public.invoices (workspace_id, tenancy_id, billing_period)
  where tenancy_id is not null and billing_period is not null and status <> 'VOID';
```

The partial unique index IS the dedupe mechanism — application logic checks first for
friendliness, but the database guarantees a (tenancy, month) can never be
double-billed even under concurrent clicks. VOIDed invoices are excluded so a
mistake can be voided and regenerated. Fold into `schema_bundle.sql`. `Invoice` type
(`src/lib/data/invoices.ts` — NOT domain.ts, same correction as M1) gains
`billing_period: string | null`.

## 2. Pure generator — `src/lib/invoices/recurring.ts` (the heavily-tested core)

```ts
computeRentInvoicePlan(tenancies: Tenancy[], existing: ExistingKey[], month: 'YYYY-MM')
  → { toCreate: PlannedInvoice[]; skippedExisting: number; skippedNoRent: number }
```

Qualification rules (all pure, all unit-tested):
- Tenancy overlaps the month: `start_date <= monthEnd && (end_date is null ||
  end_date >= monthStart)` (calendar-date string comparison, the house lexical-ISO
  style from `timeline.ts`).
- `rent_amount` is a finite number > 0 (else counted in `skippedNoRent`).
- No existing non-VOID invoice for (tenancy_id, month) (else `skippedExisting`).

PlannedInvoice: `party_type 'TENANT'`, `party_name` = linked tenant's full_name if
`tenant_id` set (P1) else `tenant_name`, `direction 'OUTBOUND'`, `status 'DRAFT'`,
`billing_period` = monthStart, `issue_date` = today, `due_date` = today + 14 days,
attribution links: tenancy_id + unit_id (+ property_id resolved from the unit), one
line item `Rent — <Month YYYY>` (formatted via the finance `formatMonth` helper),
qty 1, unit_amount = rent_amount, currency EUR.

## 3. Action + UI

- **`generateRentInvoicesAction(month)`** in `src/app/(app)/invoices/actions.ts`:
  `requirePermission('finance:write')`; loads tenancies + existing (tenancy_id,
  billing_period) keys for that month (RLS client); runs the pure planner; inserts
  each invoice + line item sequentially (reusing `createInvoice`/line-item helpers);
  a 23505 unique-violation on any insert is caught and counted as skipped (the
  concurrent-click case), never surfaced as an error. Redirects to
  `/invoices?generated=<created>&skipped=<n>` → toast ("Drafted 3 rent invoices ·
  2 already billed").
- **UI on `/invoices`:** a "Generate rent" outline button (finance:write only) opening
  a small house-pattern Dialog: `<input type="month">` defaulting to the current
  month + explainer line ("Drafts one invoice per active tenancy with a rent amount.
  Existing invoices for the month are skipped.") + submit. Uses `ConfirmSubmit`-style
  layout but a plain form is fine (drafts are reviewable/voidable — not destructive).
- **Overdue visibility:** derived, no silent status mutation — in the invoices list
  and detail, when `due_date < today && status in ('SENT','PARTIAL')`, render the
  existing `OVERDUE` badge tone alongside/instead of the status badge (use
  `StatusBadge kind="invoice_status" value="OVERDUE"` as the visual; the stored
  status is unchanged). Add an "Overdue" quick filter chip to `InvoiceFilters`
  (client-side predicate on the already-loaded page is NOT possible with DB
  pagination — implement as a `?overdue=1` param handled in `listInvoicesPage` via
  `.lt('due_date', today).in('status', ['SENT','PARTIAL'])`).
- **Delete `/preview/rent-automation` + nav entry in the same commit** the button
  ships (swap rule).

## 4. Out of scope (v1)

Automatic sending (drafts are the point — human reviews), proration for partial
months (full rent regardless of overlap length — document in the dialog copy? No:
keep copy short; note in spec only), payment reconciliation/PARTIAL automation,
deposit/fee recurrence, cron-based auto-generation (revisit post-self-host).

## 5. Board decomposition

- **P3-1** `[builder]` `[rls]` — migration 0027 + bundle fold + `Invoice` type field +
  `recurring.ts` pure planner + exhaustive unit tests (month-overlap edges: starts
  mid-month, ends first-of-month [half-open? end_date is inclusive per rent-roll
  convention — match `timeline.ts` semantics exactly and test both boundaries],
  no-rent, dedupe, VOID-excluded).
- **P3-2** `[builder]` — action + dialog + toast + overdue badge/filter +
  **delete `/preview/rent-automation`**. Depends P3-1 (and benefits from P1's
  tenant_id linkage but must work without it — tenant_name fallback).
- **P3-3** `[verify]` — after USER runs 0027: generate for current month on the live
  seed → drafts match qualifying tenancies; regenerate → all skipped; void one +
  regenerate → recreated; overdue chip filters correctly; accountant can generate,
  operator cannot.

**USER queue addition:** run migration 0027 (after P3-1 lands).
