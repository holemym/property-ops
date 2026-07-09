# Property Ops — Demo Mode (Track D) — Design

**Date:** 2026-07-09 · **Status:** approved · **Depends on:** S1 (limiter + invite-only
signup page; build right after it)

A public, self-resetting sandbox entered from the login/signup pages with one click and
no account: seeded Vienna portfolio, every shipped feature usable, dormant integrations
simulated, unbuilt roadmap features shown as labelled previews. It doubles as the
product demo for prospects.

Read roadmap v2 §2 (hard rules) first.

---

## 1. Entry & auth

**UI:** "Explore the demo" button on `/login` and `/signup` (with `SIGNUP_MODE=invite`,
the signup page reads: *"Accounts are by invitation — or explore the demo with sample
data."*). Button posts to a server action `enterDemo()` in `src/app/(auth)/demo-actions.ts`.

**Gating:** `DEMO_MODE=on` env flag (helper `src/lib/demo.ts: isDemoEnabled()`); when
unset, no button renders and `enterDemo` rejects. Entry is rate-limited
(`demo:<ip>`, 5/10 min, via S1.3).

**`enterDemo()` flow (server action):**
1. `isDemoEnabled()` else redirect `/login`.
2. Rate-limit check.
3. Maybe-reset (see §3).
4. `supabase.auth.signInAnonymously()` on the **server client** (sets session cookies).
5. Service client: `update profiles set workspace_id = <demo ws>, role = 'OPERATOR',
   full_name = 'Demo visitor' where id = <new anon user id>` (the `handle_new_user`
   trigger already created the profile row on auth-user insert; anonymous users have no
   email — defaults are fine).
6. `redirect('/dashboard')`.

**Why anonymous sessions, not a shared demo login:** a shared credential's session
holder could `updateUser({ password })` from the browser console and hijack the demo
account. Anonymous users are per-visitor throwaways; console mischief is confined to
their own user, and everything they can reach is already RLS-scoped to the demo
workspace and wiped on reset.

**USER action (one-time):** Supabase dashboard → Auth → Providers → enable
**Anonymous sign-ins**. Add `DEMO_MODE=on` + `DEMO_WORKSPACE_ID` to Vercel env
(production) and `.env.local`.

## 2. The demo workspace

**Migration 0023** (idempotent; fold into `schema_bundle.sql`; RLS review required):
- `alter table workspaces add column if not exists is_demo boolean not null default false;`
- `alter table workspaces add column if not exists demo_reset_at timestamptz;`
- Storage: tighten the `storage.objects` INSERT policies (attachments + documents
  buckets) to also require the path's workspace folder ≠ the demo workspace
  (`not exists (select 1 from workspaces w where w.id::text = (storage.foldername(name))[1] and w.is_demo)`)
  — belt-and-braces with the app-level block in §4.
- `create function public.reset_demo_workspace() returns void` — SECURITY DEFINER,
  service-role-execute-only (revoke public/anon/authenticated): deletes all demo-
  workspace rows (children→parents FK order: attachments, comments, events, vendor
  tokens, tickets, line items, invoices, income/expense, documents, tenancies, units,
  vendors, properties), re-inserts the canonical seed, stamps `demo_reset_at = now()`.
  It does **not** touch profiles/auth users — visitor cleanup happens in the app via
  `auth.admin.deleteUser` (§3), whose `on delete cascade` removes the profile rows.

**Seed:** the canonical seed lives IN the migration/function (SQL insert block —
adapted from `supabase/apply-batch-live.sql`): 3 properties (Ringstrasse Residenz,
Mariahilfer Hof, Donaukanal Lofts), 10 units, 4 vendors, 8 tickets across all
statuses/priorities with events + comments, 8 tenancies (one ending soon → lease
alert), income/expenses across 6 months, 5 documents (metadata-only, incl. one
expiring), 6 invoices in mixed statuses (one overdue). Fixed UUIDs so the reset is
deterministic. **Gotcha from the live seeding:** the `tickets_force_safe_insert_defaults`
trigger flattens seeded tickets when `auth.uid()` is null — the reset function must
`alter table tickets disable trigger ...` around its ticket inserts and re-enable after
(fine inside the SECURITY DEFINER function).

**Creation:** migration inserts the demo workspace itself (fixed UUID = the
`DEMO_WORKSPACE_ID` env value) with `is_demo = true`, then calls the reset function
once. **USER action:** run migration 0023.

## 3. Reset — stale-on-entry, no cron

In `enterDemo()`, before sign-in (service client): read the demo workspace's
`demo_reset_at`; if older than **24h** (or null), call `reset_demo_workspace()` RPC and
`auth.admin.deleteUser` each stale anon profile it reported/queried (anon users
attached to the demo workspace with `created_at` > 24h old). Best-effort with
try/catch: a failed reset never blocks demo entry (log it). Also expose the same reset
as a manual server action available to SUPER_ADMIN for emergencies.

Anonymous-session JWT lifetime follows the project's session settings (S1.6 runbook);
stale anon **users** are purged by the entry-time cleanup above.

## 4. In-demo behavior differences

Central helper: `getCurrentUser()` already returns `workspaceId`; add
`src/lib/demo.ts: isDemoWorkspace(workspaceId): Promise<boolean>` with a
module-level cached lookup of the demo workspace id (env `DEMO_WORKSPACE_ID`, so no DB
hit: `workspaceId === process.env.DEMO_WORKSPACE_ID`).

| Surface | Behavior in demo |
|---|---|
| Writes (tickets, kanban, invoices, tenancies, finance, comments) | **Real** — sandboxed by RLS, wiped by reset |
| File uploads (attachments, documents, vendor proof) | Blocked in the actions (`FormError`: "Uploads are disabled in the demo") + storage policy (0023) |
| Settings → Users (invite/deactivate) | Actions reject for demo workspace; page shows a demo notice |
| Invoice **Send** / email notifications | Simulated: action detects demo → skips `sendEmail`, marks DRAFT→SENT, toast "Invoice sent — demo simulation"; notification emails silently skipped |
| AI triage | Runs the **real offline heuristic** (already key-free); demo forces the heuristic path even if `ANTHROPIC_API_KEY` is set (guard in `triage-service.ts`) so visitors can't burn tokens |
| Vendor job links | Generate + open normally (token pages are workspace-scoped and reset) |
| Demo banner | Persistent slim bar in `(app)/layout` when `isDemoWorkspace`: "Demo workspace — sample data, resets daily · Sign-ups by invitation" |

## 5. Preview section (unbuilt features as mocks)

Nav gains a **"Preview"** group, rendered only in the demo workspace, with four
static, presentational pages under `src/app/(app)/preview/*` fed by hardcoded fixtures
shaped like the demo seed (no DB, no new tables). Each page: `PageHeader` with a
"Planned — preview" `Badge`, realistic graphite-system UI, a one-line "what this will
do" footer:
- `/preview/map` — static positioned pins on a stylized (non-interactive) Vienna map
  panel with property popovers. **Replaced by the real `/map` when Track M ships**
  (then remove this page and move the nav item out of Preview).
- `/preview/notifications` — bell inbox mock (assigned/status/expiry items).
- `/preview/people` — tenant-directory mock (list + one profile card).
- `/preview/rent-automation` — "Generate July 2026" mock showing draft invoices diff.

Swap rule for later tracks: when the real feature ships, delete its preview page —
the demo then shows the live surface automatically. Keep each preview a single file so
deletion is trivial.

## 6. Files touched (build map)

- `src/app/(auth)/demo-actions.ts` (new) · login/signup pages (button + copy)
- `src/lib/demo.ts` (new helpers) · `src/lib/ai/triage-service.ts` (heuristic pin)
- Upload + invite + email-send actions: demo guards (small, localized checks)
- `src/components/layout/DemoBanner.tsx` (new) + `(app)/layout.tsx`
- `src/components/layout/Sidebar.tsx` (Preview group, demo-gated)
- `src/app/(app)/preview/{map,notifications,people,rent-automation}/page.tsx` (new)
- `supabase/migrations/0023_demo_mode.sql` (+ `schema_bundle.sql`)

## 7. Testing & acceptance

- Unit: `isDemoWorkspace` env logic; upload/invite/send guards (pure branches);
  preview pages render (existing pattern: no page-render tests — skip, keep to logic).
- RLS suite: `reset_demo_workspace` not executable by anon/authenticated; demo storage
  INSERT denied.
- Manual: entry from clean browser → dashboard with seed; kanban drag works; upload
  blocked with friendly error; invoice Send shows simulated toast; AI note appears on
  a new ticket; banner shows; second visitor (incognito) gets own session, same data;
  after forcing `demo_reset_at` back 25h, next entry resets edits.
- Acceptance: a stranger with only the public URL can reach a fully-populated,
  fully-navigable demo in one click and **cannot** touch any real workspace, upload
  files, invite users, or send real email.

## 8. Risks & mitigations

- **Abuse via writes** (junk text in demo tickets): bounded by reset + entry rate
  limit; acceptable. Uploads (the real abuse vector) are blocked at two layers.
- **Anon-user buildup:** purged at entry-time cleanup; worst case is idle rows.
- **Seed drift vs schema:** the seed lives next to the schema in migrations; any
  future migration touching seeded tables must update the reset function's seed block
  (add to that migration's checklist).
- **Preview pages read as broken features:** every preview carries the "Planned —
  preview" badge + explainer line.
