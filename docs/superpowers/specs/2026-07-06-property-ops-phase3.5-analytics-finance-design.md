# Phase 3.5 — Analytics + Finance-light — Design Spec (2026-07-06)

Goal: a decision-grade insights layer (not vanity metrics) that culminates in **profit-per-unit**
(income − maintenance cost). Built in two sequenced parts in one push (user decision 2026-07-06):
**Part A** analytics on data we already have (no schema change), then **Part B** finance-light
(new tables + RLS) so profit-per-unit becomes computable.

Stack constraints unchanged: Next.js 16.2.10 (read `node_modules/next/dist/docs/` when unsure),
shadcn wraps `@base-ui/react` (`render` prop, not `asChild`), Tailwind v4, graphite design system
(reuse `StatusBadge`, `PageHeader`, `EmptyState`, `Skeleton`, `Card`). Keep `npm run build`/`lint`/
`test` (133 baseline) green; finance RLS gets an adversarial review gate before merge (project norm).

## Part A — Analytics on existing data (NO migration)

New pure aggregation layer `src/lib/data/analytics.ts` — workspace-scoped, RLS-safe reads over
`tickets` (+ `actual_cost`/`estimated_cost`/timestamps), `vendors`, `units`, `properties`. All
aggregation is pure functions over fetched rows so it's unit-testable without a DB.

Metrics (MVP):
- **Cost overview**: total actual spend, open-cost exposure (Σ `estimated_cost` of open tickets),
  spend vs. estimate variance.
- **Cost by category** (`ticket_category`) and **by property**.
- **Vendor benchmarking**: per vendor → jobs handled, avg `actual_cost`, avg cycle time
  (`created_at`→`resolved_at`/`closed_at`), still-open count.
- **Problem-unit ranking**: units ranked by ticket count and total maintenance cost.
- **Cycle times**: median/avg time-to-resolve overall and by priority.
- **Trends**: tickets opened vs. resolved, and spend, bucketed by month.

UI: new route `src/app/(app)/insights/page.tsx` + `loading.tsx`. Charts via **Recharts** (new dep;
React-native, composable, themeable to graphite — bars/lines/tables only, no 3D/pie-spam). Role-gated
`requirePermission('analytics:read')`. Nav: add "Insights" to the sidebar (managers + accountant).

Permissions: add `analytics:read` → SUPER_ADMIN, OWNER, OPERATOR, ACCOUNTANT.

## Part B — Finance-light (migration 0016 + RLS)

### Schema (migration `0016_finance.sql`)
Two workspace-scoped tables following the 0003/0009 template exactly (RLS enabled in the SAME file;
composite FKs to pin cross-workspace integrity; no DELETE policy — soft/void later):

`public.income_records`
- id, workspace_id (FK workspaces, cascade), property_id? , unit_id? (nullable composite FKs to
  properties/units `(id, workspace_id)`, MATCH SIMPLE), amount numeric NOT NULL, currency text
  (default workspace currency), category `income_category` enum (RENT, DEPOSIT, FEE, OTHER),
  period_start date, period_end date?, notes text, created_by_user_id (FK profiles), created_at,
  updated_at (+ set_updated_at trigger).

`public.expense_records`
- same shape + `ticket_id?` nullable composite FK to `tickets (id, workspace_id)` (link a manual
  expense to a ticket), category `expense_category` enum (MAINTENANCE, UTILITIES, TAX, INSURANCE,
  MANAGEMENT, OTHER). NOTE: ticket `actual_cost` is the PRIMARY maintenance-cost signal; manual
  expense_records capture non-ticket costs. Analytics sums BOTH (dedupe: an expense_record linked to
  a ticket supersedes that ticket's actual_cost to avoid double-count — documented in analytics.ts).

### RLS (the security-sensitive part — mirrors the 0003 template)
New helper `public.can_manage_finance()` (SECURITY DEFINER, pinned search_path, is_active-aware):
`current_role() in ('SUPER_ADMIN','OWNER','ACCOUNTANT') and coalesce(current_is_active(),false)`.
- SELECT: `workspace_id = current_workspace_id() and current_role() in
  ('SUPER_ADMIN','OWNER','OPERATOR','ACCOUNTANT')` OR SUPER_ADMIN platform override. (Operators read
  but don't write — they run ops, not books.)
- INSERT/UPDATE: `workspace_id = current_workspace_id() and can_manage_finance()` (explicit WITH
  CHECK). No SUPER_ADMIN platform write override (NULL-workspace fail-closed, per 0003).
- No DELETE policy (default-deny). TENANT/GUEST/VENDOR: zero access (fail-closed).
Composite-FK note: add `unique (id, workspace_id)` only if a later table references these.

Permissions matrix: add `finance:read` (SUPER_ADMIN, OWNER, OPERATOR, ACCOUNTANT) and `finance:write`
(SUPER_ADMIN, OWNER, ACCOUNTANT — NOT operator). ACCOUNTANT thus gains write here (first write perm).

### Data + UI
- `src/lib/data/finance.ts` — income/expense CRUD (server actions, `requirePermission('finance:write')`,
  RLS-scoped). Validation via zod. Composite ownership check before insert (friendly layer over the FK).
- `src/app/(app)/finance/page.tsx` (+ loading) — bookkeeping overview: income vs. expense totals,
  net by month, entry tables, **CSV export** (server action streaming a CSV of the period). Entry
  forms (income/expense) as cards with `useFormStatus` pending + `?error` toast.
- Nav: add "Finance" (managers + accountant).

### The payoff — profit-per-unit
`analytics.ts` gains `profitPerUnit()` = Σ income(unit) − Σ maintenance cost(unit) over a period,
surfaced on the Insights page once finance data exists. Units with no income row show cost-only.

## IA / navigation
Sidebar gains "Insights" and "Finance" (both role-gated; hidden from tenants). Order:
Dashboard · Properties · Units · Vendors · Tickets · Insights · Finance.

## Testing
- Analytics: unit tests on the pure aggregation functions (fixtures → expected metrics). Adds to the
  133 baseline.
- Finance RLS: extend `tests/rls/*.rls-test.ts` — accountant can write finance; operator read-only;
  tenant zero; cross-workspace blocked. Runs under `npm run test:rls` (env-gated).
- Migration smoke tests: SMOKE TESTS comment block in 0016 (per project norm), run on live Supabase.

## Non-goals (YAGNI)
Multi-currency conversion, accounting-grade double-entry ledger, invoicing/AR, tax reporting,
recurring-rent automation, per-tenant statements. This is decision-support + light bookkeeping only.

## Build order
1. Part A analytics (data layer + pure-fn tests + Insights page + Recharts + nav) — commit.
2. Part B migration 0016 + RLS + can_manage_finance() → **RLS review gate** → permissions + finance
   data layer + Finance page + CSV export + profit-per-unit on Insights + RLS tests — commit.
3. Live: apply 0016 (append to schema_bundle.sql too), run its smoke tests, run test:rls.
