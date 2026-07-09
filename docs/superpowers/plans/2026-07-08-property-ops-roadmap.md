# Property Ops — State Assessment & Roadmap (2026-07-08)

> **SUPERSEDED 2026-07-09** by `2026-07-09-property-ops-roadmap-v2.md`.
> All three tracks below (A develop, B polish, C mobile) are complete. Kept for history.

## 1. Where we are

A multi-tenant property-management SaaS, **live on Vercel** (property-ops-sandy.vercel.app),
Supabase Postgres with RLS as the enforcement boundary. Next.js 16 (App Router, RSC,
Turbopack) · Tailwind v4 · Base-UI-backed shadcn · zod · Vitest (254 unit tests green).
Graphite near-monochrome design system; saturated colour reserved for status.

**Built and shipped (Phases 1–4 complete):**

| Area | Status |
|---|---|
| Auth, workspaces, RBAC (7 roles), RLS, composite-FK tenant isolation | ✅ |
| Properties · Units · Vendors (+ hubs) | ✅ |
| Tickets: full lifecycle, kanban board, calendar, events, comments, tenant portal, vendor secure links, attachments | ✅ |
| Occupancy tape chart (+ cursor-anchored zoom/pan) · Rent roll | ✅ |
| Analytics/Insights (interactive charts) · Finance-light (income/expense, CSV export, profit-per-unit) | ✅ |
| Documents hub (typed, per-entity, expiry alerts, Storage) | ✅ |
| **Phase 4:** AI triage *(disconnected)* · Email notifications *(disconnected)* · Invoicing (full) · Owner statements | ✅ |
| Global ⌘K command palette (search + navigation + create) | ✅ |
| Perf: DB pagination + sort (tickets/invoices), per-request auth cache, trigram + hot-path indexes | ✅ |
| UX: nav grouping, per-click pending, loader coverage, portal status stepper, scannability spines, transitions | ✅ |

Migrations 0001–0020 applied to production.

**Key patterns to preserve:** RLS is the security boundary (every new table gets an
adversarial RLS review); composite `(child_id, workspace_id)` FKs; the "disconnected
integration" pattern (env-key-gated, best-effort, never-throws — no cost/deps until a key
is added); no-new-deps discipline; write-only subagents on disjoint files + central verify.

**Two integrations are dormant** (built, off): AI triage (`ANTHROPIC_API_KEY`) and email
(`RESEND_API_KEY`). They no-op at zero cost until keys are added.

## 2. Gaps / where it goes next

**Product**
- Invoicing has **no delivery** — you can print but not send; invoices store no recipient email.
- **Reports/export** are thin (finance CSV only); no invoice/owner-statement export, no portfolio report.
- **Search** could be smarter — no recent items, no matched-text highlight.
- **People** are thin — tenants are just names on tenancies; no tenant directory / contact record.
- **No in-app notifications** surface for the events the system already logs.
- External **owner/tenant portals** are minimal (owner view is internal-only statements).

**Quality**
- Dashboard status tally + owner rollups still aggregate in JS (perf).
- Accessibility is partial (keyboard/ARIA/contrast not audited end-to-end).
- Empty/error states and copy are inconsistent across newer screens.

**Mobile** — the shell is desktop-only: fixed `w-56` sidebar + top bar, wide data tables,
mouse-only kanban DnD. Unusable on a phone today.

## 3. Plan — three tracks, in the requested order

### Track A — Develop the planned features
Ordered by value / independence:

- **A1. Invoice & statement delivery.** Add an optional `recipient_email` to invoices
  (light migration + form field). A "Send" action on the invoice/statement emails it via
  the existing email module (disconnected-safe). Completes invoicing's purpose.
- **A2. Reports & export.** CSV export for invoices and owner statements; a print/PDF path
  reusing the existing print layouts; optionally a small "Reports" surface.
- **A3. Search polish.** Recent-items (localStorage) shown on empty ⌘K; highlight the
  matched substring in results; light ranking (prefix > substring).
- **A4. Performance.** Move the dashboard status tally + owner rollups to DB aggregates
  (verify PostgREST aggregate support first); trim remaining over-fetch on the dashboard.
- **A5. (stretch) People/tenant directory** and **in-app notifications** — larger, scope
  when the above land.

### Track B — Polish perfectly
- Cross-screen consistency audit (spacing, page headers, badges, empty states, error toasts).
- Micro-interactions + motion consistency; focus-visible everywhere.
- Accessibility pass: keyboard nav, ARIA roles/labels, colour contrast, reduced-motion.
- UX copy pass (labels, empty states, confirmations).

### Track C — Mobile / phone adaptation
- **Responsive shell:** sidebar → off-canvas drawer behind a hamburger; responsive top bar;
  ⌘K trigger collapses to an icon.
- **Responsive data:** wide tables → stacked cards below `sm`; forms full-width; larger touch targets.
- **Touch interactions:** kanban keyboard/touch move; tape-chart pinch (already partial); calendar.
- **Breakpoint QA** at 375 / 768 / 1280; safe-area insets.

**Sequencing note:** Track C (mobile) reworks the app shell that Track B (polish) also
touches — so B and C should be coordinated for the shell (do the responsive shell once,
polished). Suggested overall order: **A1 → A2 → A3 → A4**, then **B+C together** shell-first.

## 4. Immediate next step
Start **A1 (invoice/statement delivery)** — it's the highest-value planned gap and exercises
the dormant email module. Then proceed down Track A.
