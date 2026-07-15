# Property Ops — Roadmap v2 (2026-07-09)

Supersedes `2026-07-08-property-ops-roadmap.md` (Tracks A/B/C there are **complete**).
This document is written to be executed by any model without prior context: read §2
(hard rules) before touching code, and follow §5 (sequencing) top to bottom.

---

## 1. State snapshot

Multi-tenant property-management SaaS, **live** at property-ops-sandy.vercel.app
(Vercel project `property-ops`, GitHub `holemym/property-ops`, Supabase project ref
`mdnffpqwudsyldhembzo`, eu-west-1). Next.js 16.2.10 (App Router, RSC, Turbopack,
`src/` dir) · Supabase (`@supabase/ssr`) · Tailwind v4 · Base-UI-backed shadcn · zod ·
Vitest (**261 unit tests** + env-gated RLS suite `npm run test:rls`).

Everything in roadmap v1 is shipped: Phases 1–4 (auth/RBAC/RLS, properties/units/
vendors + hubs, full ticket lifecycle + portal + vendor links + attachments, occupancy
tape chart, rent roll, insights, finance, documents, AI triage *(disconnected)*, email
*(disconnected)*, invoicing + delivery, owner statements, ⌘K search), Track A (invoice
email, CSV exports, search polish), Track B (a11y/consistency/motion/touch polish,
shared `formatDate`/`FormError`/`ConfirmSubmit`), Track C (full mobile pass).
Migrations **0001–0021** applied to production.

## 2. Tech inventory & hard rules (read before coding)

**Stack:** deps in `package.json` are the allowlist. Adding a dependency requires an
explicit roadmap entry (currently approved: `leaflet` for the map, `next-intl` for P4).
Integrations (Resend, Nominatim, Anthropic) are **raw `fetch`, no SDKs**, gated on env
keys, best-effort, never-throw — the "disconnected integration" pattern
(`src/lib/email/send.ts` is the reference implementation).

**Rules that are lint/build errors or production breakers:**
- React Compiler is ON: no `setState` in an effect body; no manual
  `useCallback`/`useMemo` with non-trivial deps; no mutating a `let` during render/`.map`.
- shadcn wraps **@base-ui/react, not Radix**: compose via `render={<Link/>}`; `asChild`
  does not exist.
- Middleware is `src/proxy.ts` (`export function proxy`) — `middleware.ts` builds but
  silently never runs. Public routes go in `PUBLIC_PATHS` (exact-or-subpath matching).
- Supabase untyped `.select(cols)` results need `as unknown as Row[]`.
- **Row-type location is SPLIT — do not state a blanket rule (M1 and P1-1 briefings each
  got this half-wrong and the builders had to correct it).** The early tables keep their
  row type LOCAL in `src/lib/data/<entity>.ts`: `Property`, `Unit`, `Vendor`, `Ticket`,
  `Tenant`. Everything added from migration 0016 onward lives in `src/types/domain.ts`:
  `Tenancy`, `Document`, `IncomeRecord`, `ExpenseRecord`, `Invoice`, `InvoiceLineItem`.
  When adding a FIELD to an existing type, edit it wherever it already lives (grep for
  `export type <Name>`); when adding a NEW entity, follow the nearest precedent the spec
  names. `domain.ts` also holds the shared enums.
- Every new workspace-scoped table referencing another workspace-scoped table needs the
  composite `(child_id, workspace_id)` FK pattern (FK validation bypasses RLS).
- SECURITY DEFINER functions: `revoke execute ... from public` + explicit grants; RLS
  helper functions called inside policies must stay executable by `authenticated`.
- Migrations: next free number (0022+), idempotent (`if not exists` guards), and **also
  folded into `supabase/schema_bundle.sql`**. Any migration touching RLS/policies gets
  an adversarial RLS review before commit.
- Local branch is `master` tracking `origin/graphite-polish`: push with
  `git push origin HEAD:graphite-polish` (bare `git push` fails; pushing auto-deploys).
- Bash working dir resets between calls — prefix every command with
  `cd /c/Users/User/Downloads/clauderoom/property-ops`.
- The assistant is classifier-blocked from running production DDL and changing Supabase
  account settings — migrations and dashboard toggles are **USER actions**: prepare the
  SQL/checklist, ask the user to run it, verify afterwards.

**Verification protocol for every commit:** `npm run build` + `npm run lint` +
`npx vitest run` all green. New pure logic gets unit tests in `tests/unit/`.

**Design system:** graphite near-monochrome, saturated colour reserved for status;
compact 32px controls (deliberate — do not inflate); shared primitives live in
`src/components/common/` (`PageHeader`, `EmptyState`, `FormError`, `ConfirmSubmit`,
`Pagination`, skeletons) and `src/lib/` (`format-date`, `status`, `relative-date`) —
reuse them, never fork per-page variants. Motion via `--duration-*`/`--ease-*` tokens,
`motion-safe:` guards.

**Housekeeping (do opportunistically):** `src/components/common/DataTable.tsx` is dead
code — delete it in the next touching commit.

## 3. Security audit findings (2026-07-09)

Audited: headers, auth flows, rate limiting, token entropy, storage, injection
surfaces, validation coverage, secrets handling.

**Sound:** RLS as enforcement boundary (adversarially reviewed per migration);
composite-FK isolation; 256-bit vendor capability tokens SHA-256-hashed at rest;
60s signed-URL TTLs on private buckets; zod on all forms; no
`dangerouslySetInnerHTML`; PostgREST-filter injection guard on search; auth-gated API
routes; HTML-escaping in email templates; `.env.local` gitignored; service key
lazily read server-side only.

**Gaps → fixed by Track S:**

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | No HTTP security headers (empty `next.config.ts`) | High | S1.1 |
| 2 | Public self-signup open to the internet | High | S1.2 |
| 3 | No rate limiting (login, signup, search, job tokens) | High | S1.3 |
| 4 | Raw Supabase error strings round-trip via `?error=` | Low | S1.4 |
| 5 | No upload size/type constraints | Medium | S1.5 |
| 6 | Password policy = Supabase default (6 chars), no MFA | Medium | S1.6 / S2.1 |
| 7 | No auth audit trail (logins, denials) | Medium | S2.2 |
| 8 | Session/JWT lifetimes never deliberately set | Low | S1.6 runbook |
| 9 | No dependency-audit routine | Low | S2.4 |
| 10 | No self-host/exit plan for a sensitive-data system | Medium | S3 |

## 4. Tracks

### Track S — Security hardening
Spec: `docs/superpowers/specs/2026-07-09-property-ops-security-hardening-design.md`
- **S1 (build first):** security headers + CSP (report-only → enforced) · invite-only
  signup (`SIGNUP_MODE`) + `/auth/set-password` for invited users · Postgres-backed
  rate limiter (migration 0022) on login/signup/search/job-token · error-message
  normalization · upload constraints · password zod policy + Supabase dashboard runbook.
- **S2 (after P2):** TOTP MFA enrollment + enforcement for manager roles · `auth_events`
  audit table + admin surface · CSP nonce upgrade · `npm audit` routine.
- **S3 (docs-only, right after Demo):** self-hosting runbook (Docker-compose Supabase +
  Next standalone + Caddy TLS + backups), portability rules, export/cutover checklist.

### Track D — Demo mode
Spec: `docs/superpowers/specs/2026-07-09-property-ops-demo-mode-design.md`
Public sandbox from the signup/login pages: anonymous Supabase sessions provisioned
into one `is_demo` workspace with seeded Vienna data; stale-on-entry reset (no cron);
writes real, uploads/invites blocked; email simulated, AI triage runs its real offline
heuristic; "Preview" nav section shows mock screens of unbuilt roadmap features.
Migration 0023.

### Track M — Map view
Spec: `docs/superpowers/specs/2026-07-09-property-ops-map-view-design.md`
Leaflet + OSM tiles + Nominatim geocode-on-save (stored lat/lng, migration 0024);
`/map` page with property pins/popups; "Locate missing" backfill; grayscale tile
treatment; CSP allowance for tile hosts. First approved new dependency (`leaflet`).

### Track P — Product depth (spec each via brainstorming when its turn comes)
- **P1 Tenant directory:** `tenants` table (PII SELECT gated to manager+accountant,
  like tenancies), optional `tenancies.tenant_id` composite FK with `tenant_name`
  fallback, `/people` list/detail (linked tenancies + tickets), tenant picker in forms.
- **P2 In-app notifications:** `notifications` table written by the same actions that
  already log ticket/document events; TopNav bell + unread count; `/notifications`
  inbox with mark-read; refetch-on-navigation (no realtime infra in v1).
- **P3 Recurring rent invoices:** "Generate [month]" button on `/invoices` creating
  DRAFT invoices from active tenancies with `rent_amount`, deduped per
  (tenancy, month); overdue badge/filter. Review-then-send; no cron.
- **P4 German i18n:** `next-intl`, cookie-based locale (no URL churn), EN default +
  full DE dictionaries. Done last so P1–P3 screens don't churn mid-translation.

### Backlog (unscheduled)
Owner external portal · inspections/checklists · key management · meter readings ·
PWA/offline · realtime notifications · dashboard/owner DB aggregates (A4 — needs
PostgREST aggregate verification against live) · Stripe/payments.

## 5. Sequencing

```
S1 security  →  D demo mode  →  S3 self-host runbook (docs)  →  M map
→  P1 tenants  →  P2 notifications  →  P3 recurring rent  →  S2 security deep
→  P4 i18n
```

Rationale: S1 first because every later surface inherits it and D reshapes the same
signup page; D early because each later feature enriches the demo automatically; S3 is
docs-only and unblocks the hosting decision; M is small and satisfies the immediate
feature want; P4 last so the translation surface is stable.

**Per-item done-definition:** acceptance criteria in its spec met · build+lint+tests
green · migration folded into `schema_bundle.sql` + RLS-reviewed (if any) · pushed to
`graphite-polish` · USER-action items (SQL to run, dashboard toggles) explicitly listed
in the handoff message · memory/roadmap updated.

## 6. Standing USER-action queue

- Verify migration 0021 applied (`invoices.recipient_email`) — check documented in chat.
- Each new migration 0022+ — run in Supabase SQL editor when handed off.
- S1.6 dashboard checklist (leaked-password protection, session lifetimes, OTP expiry).
- Demo mode: enable the Anonymous sign-in provider (Auth → Providers → Anonymous).
- Optional integrations, when wanted: `RESEND_API_KEY` (email), `ANTHROPIC_API_KEY`
  (AI triage) — both already wired, disconnected-safe.
