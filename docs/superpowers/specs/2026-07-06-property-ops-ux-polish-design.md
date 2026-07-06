# Property-Ops UX Polish — Design Spec (2026-07-06)

Presentational + feedback-layer polish pass on the operator app. **No new features, no
data-model/RLS changes, no server-action contract changes.** Direction: **slate/graphite,
near-monochrome — saturated color reserved almost entirely for status.** Scope: full pass +
tasteful micro-motion (reduced-motion aware).

## Root cause of the "unstyled" look (already diagnosed)
1. `globals.css` maps `--font-sans: var(--font-sans)` (self-referential → undefined) while
   `layout.tsx` defines the Geist font as `--font-geist-sans`. Result: browser serif everywhere.
2. Palette is pure-neutral boilerplate (fine for graphite — keep it, just make it deliberate).
3. Zero `loading.tsx` files; mutations do full-page reloads though `sonner` is installed.
4. Root metadata still "Create Next App".

## Stack constraints (do not rediscover)
- **Next.js 16.2.10** — this is NOT the Next you know. If unsure about a convention
  (`loading.tsx`, metadata, `useFormStatus`, streaming), read `node_modules/next/dist/docs/`.
  App Router, `src/` dir, Turbopack. Proxy = `src/proxy.ts` (not middleware).
- **shadcn wraps `@base-ui/react`, NOT Radix** — compose via the `render` prop, never `asChild`.
  See `src/components/ui/badge.tsx` for the pattern.
- Tailwind v4 (`@theme inline` in `globals.css`), `tw-animate-css` already imported.
- Keep green: `npm run build`, `npm run lint`, `npm run test` (133) and don't touch the RLS suite.

## Shared contract (Foundation defines; all surface agents consume)
- **`src/lib/status.ts`** — single source of truth. Exports `statusBadge(kind, value)` returning
  `{ label, variant }` (or tone class) for: `ticket_status`, `ticket_priority`, `unit_status`,
  `entity_status`, vendor `is_active`. Saturated color lives ONLY here.
  - Status tones: NEW/neutral, TRIAGE/amber, WAITING_FOR_INFO/amber, ASSIGNED/blue,
    SCHEDULED/blue, IN_PROGRESS/blue, RESOLVED/green, CLOSED/neutral, CANCELLED/neutral-muted.
  - Priority: LOW/neutral, NORMAL/neutral, HIGH/amber, URGENT/red.
  - Unit: OCCUPIED/blue, VACANT/amber, MAINTENANCE/amber, BLOCKED/red. entity ACTIVE/green,
    ARCHIVED/neutral.
- **`StatusBadge`** (extends `ui/badge.tsx` with semantic tones) — consumes `statusBadge()`.
- **`ui/skeleton.tsx`** — `<Skeleton className=/>` pulsing block (reduced-motion aware).
- **`components/layout/PageHeader.tsx`** — `{title, subtitle?, actions?}`; used on every page.
- **`components/common/EmptyState.tsx`** — `{icon, title, body?, action?}`; invitation voice.
- **Toaster**: `sonner` `<Toaster/>` wired once in `src/app/(app)/layout.tsx`.
- **Motion tokens** in `globals.css` + global `@media (prefers-reduced-motion: reduce)` guard.

## Copy voice
Sentence case everywhere. Buttons = verb-first. Empty states = invitation, not apology.
No "successfully", no "please", no exclamation on system copy.

## Workstreams & file ownership (disjoint after Foundation)
- **WS1 Foundation** (agent 1, first, commits to master): `globals.css`, `src/app/layout.tsx`
  (metadata + font vars), `src/lib/status.ts`, `ui/badge.tsx`→StatusBadge, `ui/skeleton.tsx`,
  `layout/PageHeader.tsx`, `common/EmptyState.tsx`, Toaster in `(app)/layout.tsx`, motion tokens.
- **WS-A Shell + Dashboard** (parallel): `layout/Sidebar.tsx`, `layout/TopNav.tsx`,
  `WorkspaceSwitcher.tsx`, `(app)/dashboard/page.tsx` + `dashboard/loading.tsx`. Does NOT edit
  `(app)/layout.tsx`.
- **WS-B Lists** (parallel): `(app)/properties/**`, `(app)/units/**`, `(app)/vendors/**` pages +
  a `loading.tsx` each + their components; StatusBadge/PageHeader/EmptyState.
- **WS-C Tickets** (parallel): `(app)/tickets/**` (list, `[id]`, `new`) + `loading.tsx` each;
  restructure detail into cards (summary · status-flow · assignment · comments public/internal ·
  attachments · activity timeline); toasts + `useFormStatus` pending states on mutations.

## Execution
Foundation-first, then WS-A/B/C in parallel (worktree isolation, disjoint files). Each workstream
commits per its scope. Verify build+lint+test green before each commit. Small steps (600s watchdog).
