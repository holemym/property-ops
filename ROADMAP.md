# Property Ops — Task Board

The execution tracker for agent-driven development. **This file is the single source
of truth for what to build next.** Strategy lives in
`docs/superpowers/plans/2026-07-09-property-ops-roadmap-v2.md`; full designs live in
`docs/superpowers/specs/`. This board turns them into one-agent-sized tasks.

**How to work a task (any agent, any model):**
1. Read roadmap v2 **§2 Tech inventory & hard rules** — every rule there is a lint
   error, a production breaker, or a security boundary. No exceptions.
2. Read this file's entry for your task ID, then the spec section it points to.
3. Implement. Verify: `npm run build` + `npm run lint` + `npx vitest run` all green
   (baseline: **282 tests**). New pure logic gets unit tests in `tests/unit/`.
4. Commit (imperative summary, body explains why, co-author trailer per repo history).
   Push with `git push origin HEAD:graphite-polish` — bare `git push` fails.
5. Tick the checkbox here (same commit or a follow-up), and add any USER-action
   items you created to the queue at the bottom.

**Tags:** `[builder]` = prop-builder implements it · `[rls]` = prop-rls-reviewer must
review before commit · `[verify]` = prop-verifier runs it · `[plan]` = needs a design
pass first (brainstorm → spec) — do NOT jump straight to code · `[USER]` = a human
action agents cannot perform (production SQL, dashboard toggles, env vars).

**Statuses are the checkboxes.** In-progress work is fine to leave unticked with a
`(WIP <date>)` note appended.

---

## Track D — Demo mode
Spec: `docs/superpowers/specs/2026-07-09-property-ops-demo-mode-design.md`

- [x] **D1** — Migration 0023: demo workspace + seed identity + `reset_demo_workspace()`
      + storage-policy exclusion. *(committed `62ec29a`, folded into schema_bundle;
      NOT yet applied to production — see USER queue.)*

- [x] **D2** `[builder]` — Demo helpers + entry action.
      **Files:** `src/lib/demo.ts` (new: `isDemoEnabled()` = `DEMO_MODE === 'on'`;
      `isDemoWorkspace(workspaceId)` = `workspaceId === process.env.DEMO_WORKSPACE_ID`,
      pure string compare, no DB hit), `src/app/(auth)/demo-actions.ts` (new:
      `enterDemo()` per spec §1 — gate on `isDemoEnabled`, rate-limit `demo:<ip>`
      5/10min via `checkRateLimit`, stale-reset per §3 (service client reads
      `demo_reset_at`; >24h or null → rpc `reset_demo_workspace` + best-effort
      `auth.admin.deleteUser` of anon users attached to the demo workspace older than
      24h; failures never block entry), then `supabase.auth.signInAnonymously()` on the
      **server** client, service-client profile attach (workspace_id = demo ws, role
      OPERATOR, full_name 'Demo visitor'), redirect `/dashboard`).
      **Accept:** unit tests for both `src/lib/demo.ts` helpers (env-var branches);
      build+lint+tests green. `signInAnonymously` exists on supabase-js v2 — do not
      add any dependency.

- [x] **D3** `[builder]` — "Explore the demo" entry buttons. **Depends: D2.**
      **Files:** `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`.
      Render a form posting to `enterDemo()` only when `isDemoEnabled()`. On signup's
      invite-only branch the copy becomes: *"Accounts are by invitation — or explore
      the demo with sample data."* Match the existing AuthCard button styles (outline
      variant, `size="lg"`, full width).
      **Accept:** with `DEMO_MODE` unset nothing changes on either page (verify by
      reading the rendered JSX paths); build+lint+tests green.
      *(committed — login gains an outline "Explore the demo" form appended to its
      existing secondary-buttons group; signup gains the button on both the
      invite-only branch (title text swaps to the demo-aware copy) and the normal
      create-account branch (new divider + button, mirroring login's pattern); the
      transient confirm-email-sent screen is untouched. All gated on `isDemoEnabled()`
      — no new pure logic, reuses D2's helper and `enterDemo` action directly. 290
      tests green, build+lint clean.)*

- [x] **D4** `[builder]` — In-demo behavior gates. **Depends: D2.**
      Per spec §4 table. **Files:** upload actions
      (`src/app/(app)/tickets/attachment-actions.ts`, `src/app/(app)/documents/actions.ts`,
      vendor proof in `src/app/job/[token]/actions.ts`) reject demo-workspace callers
      with the existing `?error=` pattern ("Uploads are disabled in the demo");
      `src/app/(app)/settings/users/actions.ts` invite + activate/deactivate reject in
      demo; invoice send action simulates (skip `sendEmail`, still DRAFT→SENT, toast
      copy "Invoice sent — demo simulation"); `src/lib/email/notify.ts` best-effort
      sends silently skip in demo; `src/lib/ai/triage-service.ts` forces the offline
      heuristic when the ticket's workspace is the demo workspace (even if
      `ANTHROPIC_API_KEY` is set); new `src/components/layout/DemoBanner.tsx` rendered
      from `(app)/layout.tsx` when `isDemoWorkspace(user.workspaceId)` — slim bar,
      graphite tokens, copy: "Demo workspace — sample data, resets daily".
      **Accept:** every gate is a small, localized check calling `isDemoWorkspace`;
      no behavior change for non-demo workspaces (this is the critical regression
      surface — read each action's existing flow before editing); build+lint+tests
      green; unit-test any newly extracted pure branch.
      *(committed — every gate is a localized `isDemoWorkspace` check reusing D2's
      helper: the 3 upload actions + Settings→Users invite/deactivate redirect with
      `?error=` via new shared messages in `src/lib/demo.ts`; invoice Send simulates
      (DRAFT→SENT, no email, `?sent=demo` → distinct toast copy); `notify.ts`'s 5
      functions gained a `workspaceId` field on `TicketContext` and no-op in demo;
      `triage-service.ts` calls `suggestTriageHeuristic` directly instead of
      `classifyTicket` for the demo workspace; `DemoBanner` wired into `(app)/layout.tsx`.
      All gates reuse the already-tested `isDemoWorkspace` — no new pure logic needed
      unit tests. 290 tests green, no regression to non-demo paths.)*

- [x] **D5** `[builder]` — Preview nav section (4 mock pages). **Depends: D2 (for the
      demo gate); independent of D3/D4.**
      Per spec §5. **Files:** `src/app/(app)/preview/{map,notifications,people,rent-automation}/page.tsx`
      (each a single self-contained presentational file, hardcoded fixtures shaped like
      the demo seed, `PageHeader` + a "Planned — preview" `Badge` + one-line footer
      explaining what the real feature will do), `src/components/layout/Sidebar.tsx`
      gains a "Preview" nav group rendered only when `isDemoWorkspace`. Keep each page
      deletable in one `rm` (the swap rule when real features ship).
      **Accept:** graphite system only (no new colors), pages render for demo
      workspace, nav group absent otherwise; build+lint+tests green.
      *(committed — the first builder run hit an API session-limit mid-task; it had
      already left `Sidebar.tsx`/`MobileNav.tsx`/`TopNav.tsx`/`(app)/layout.tsx`
      correctly threading an `isDemo` prop through to a new `PREVIEW_GROUP` nav
      section, verified coherent and finished from there rather than re-doing it: the
      4 preview pages themselves (requireWorkspace + isTenantRole redirect, static
      fixtures matching the 0023 demo seed, PageHeader + muted "Planned — preview"
      Badge + one-line footer, tenant-role guarded). 290 tests green, no regressions.)*

- [ ] **D6** `[verify]` — Demo end-to-end. **Depends: D2–D5 + the USER queue items
      (migration 0023 applied, Anonymous provider ON, `DEMO_MODE`/`DEMO_WORKSPACE_ID`
      env set).** Playbook: fresh incognito → login page shows demo button → one click
      → dashboard with seed data → kanban move works → upload blocked with friendly
      error → invoice Send shows simulated toast → banner visible → Preview nav
      present → second incognito visitor gets own session, same data. Report
      pass/fail with evidence per check.

- [x] **D7** `[builder]` — Manual demo reset for emergencies. **Depends: D2, D4.**
      (Deferred from spec §3, flagged by the D2 build.) A server action gated to
      SUPER_ADMIN that calls the `reset_demo_workspace` RPC + stale-anon purge
      (reuse D2's `resetIfStale` internals — extract, don't duplicate), surfaced as
      a small `ConfirmSubmit` on `/settings/users` visible only to SUPER_ADMIN when
      `isDemoEnabled()`. **Accept:** unreachable + invisible for every other role;
      build+lint+tests green.
      *(committed — extracted the RPC-call + stale-anon-purge sequence out of D2's
      `resetIfStale` into a shared `resetDemoWorkspaceData(demoWorkspaceId)` in
      `src/lib/demo.ts` (returns `{ok}` instead of throwing; `demo-actions.ts`'s
      `resetIfStale` now just does its staleness check then calls it). New pure gate
      `canManuallyResetDemo(role)` = `role === 'SUPER_ADMIN'` — deliberately narrower
      than the OWNER-inclusive `ADMIN_PERMISSIONS` matrix, unit-tested for every role
      in the `Role` union. New action `resetDemoWorkspaceManually()` in
      `settings/users/actions.ts` checks `isDemoEnabled() && canManuallyResetDemo`
      (throws otherwise) before calling the shared primitive; a matching page-side
      check gates a small bordered "Demo workspace reset" section + `ConfirmSubmit` on
      `/settings/users`, invisible to every role but SUPER_ADMIN (including OWNER).
      Opportunistic housekeeping: deleted dead `src/components/common/DataTable.tsx`
      (zero importers) per the standing §2 instruction. 293 tests green (290 + 3 new),
      build+lint clean. No migration — reuses migration 0023's existing RPC, so no RLS
      review needed.)*

## Track S3 — Self-host runbook (docs only)
Spec: security-hardening design §Stage S3.

- [x] **S3-1** `[builder]` — Write `docs/runbooks/self-hosting.md` per the spec's
      4-part outline (portability rules + env matrix table of EVERY env var the code
      reads — grep `process.env.` for ground truth; Docker-compose Supabase + Next
      standalone + Caddy architecture; pg_dump/storage migration path + cutover
      checklist; operations: backup cron, restore drill, update cadence).
      **Accept:** every env var in the codebase appears in the matrix with
      required/optional + which stage needs it; no code changes.

## Track M — Map view
Spec: `docs/superpowers/specs/2026-07-09-property-ops-map-view-design.md`

- [x] **M1** `[builder]` `[rls]` — Migration 0024 (properties lat/lng/geocoded_at,
      nullable, no policy change — RLS review is a formality but run it) + `Property`
      type fields + `src/lib/geocode.ts` (raw-fetch Nominatim per spec §2:
      `buildGeocodeQuery` + `parseNominatimResponse` as PURE exported functions,
      User-Agent header, 5s timeout, never throws) + wire best-effort geocoding into
      property create/update actions (address-change detection; failed re-geocode
      nulls stale coords) + the manager-only sequential backfill action (1.1s delay,
      cap 20). Fold migration into schema_bundle.
      **Accept:** unit tests for the two pure functions (valid/empty/garbage inputs);
      no geocode call can ever block or fail a property save; build+lint+tests green.
      *(committed — RLS review came back CLEAN (no policy drift, RLS-scoped client
      only, backfill gating is real defense-in-depth) but surfaced one MEDIUM finding:
      this ships the app's first outbound third-party HTTP calls triggered by ordinary
      user actions, and neither entry point was wired through the existing
      `checkRateLimit()` (migration 0022). Fixed before commit: both property
      create/update's geocode-on-save AND the backfill loop now check a SHARED,
      workspace-scoped bucket (`geocode:<workspaceId>`, 30/60s — see the constants in
      `src/lib/geocode.ts`) before calling Nominatim, so one workspace's usage can
      never exhaust another's budget or exhaust the shared User-Agent/IP's real-world
      Nominatim budget alone (a ban there would silently break geocoding for every
      workspace on the deployment). A throttled save just skips that save's geocode
      attempt (never blocks/fails the save); a throttled backfill fails the whole
      attempt up front with a friendly `?error=` message instead of stopping partway.
      `checkRateLimit` fails open, so this is a no-op until migration 0022 is applied.
      `Property` type actually lives in `src/lib/data/properties.ts`, not
      `src/types/domain.ts` as the spec says — fields added in the real location; spec
      has a one-line inaccuracy to fix. 315 tests green (293 baseline + 22 new),
      build+lint clean. No page/UI yet — `/map` itself is M2.)*

- [x] **M2** `[builder]` — `/map` page + Leaflet. **Depends: M1.**
      Per spec §3–4: add `leaflet` + `@types/leaflet` (THE approved dependency — the
      only one), `src/components/map/PropertyMap.tsx` (`'use client'`, `next/dynamic`
      `ssr:false`, `L.divIcon` graphite pins — never the default PNG markers, OSM tile
      layer with attribution, `fitBounds`, grayscale tile filter, popup = name/address/
      units/open tickets/link), `src/app/(app)/map/page.tsx` (requirePermission
      `properties:read`, backfill button when coords missing, "N of M located" note),
      Sidebar: Portfolio → "Map" (`MapPinned` icon). **Delete `/preview/map` + its nav
      entry in the same commit** (swap rule). All Leaflet mutation inside `useEffect`
      with `map.remove()` cleanup — React Compiler rules apply.
      **Accept:** build output shows Leaflet lazy (not in shared client chunk);
      build+lint+tests green.
      *(committed — `PropertyMap.tsx` is a thin `'use client'` wrapper that
      `next/dynamic(..., {ssr:false})`-imports `src/components/map/LeafletMap.tsx` (the
      real Leaflet mutation, only ever reached through that lazy import — confirmed via
      the build's `react-loadable-manifest.json` + chunk inspection that leaflet's ~150KB
      chunk is registered only against `/map`'s loadable manifest, absent from
      `rootMainFiles`/`polyfillFiles` and from the server bundle). Graphite pins are
      lucide's `MapPin` teardrop (not `MapPinned` — that stays reserved for the Sidebar nav
      icon per spec; a sharp-tipped teardrop anchors more precisely to a lat/lng point than
      the flat-based `MapPinned` glyph) inlined as raw SVG since divIcon content is DOM, not
      JSX; popups are built via `document.createElement`/`textContent` (never innerHTML).
      Sidebar: "Map" added to the Portfolio group right after Properties,
      `properties:read`-gated; `/preview/map` + its nav entry deleted in this commit
      (swap rule). `GEOCODE_BACKFILL_CAP` moved from `map/actions.ts` into
      `src/lib/geocode.ts` — a `'use server'` file may only export async functions, so the
      page couldn't import the cap to label the backfill button ("Locate N missing")
      without relocating it; `map/actions.ts` now imports it back.
      Live-verified against this deployment's real (production) Supabase project — not
      just build/lint/tests — and that surfaced two real bugs no static check would have
      caught, both fixed before commit: (1) migration 0024 has NOT been applied here yet,
      so `latitude`/`longitude` come back `undefined` (not `null`) on every row; an
      `!== null` filter treats `undefined` as "located" and hands Leaflet an
      `(undefined, undefined)` LatLng, which throws — replaced with a `hasCoordinates`
      type predicate (`typeof x === 'number'`) that treats anything non-numeric as "not
      located" and safely degrades to the "Nothing located yet" empty state instead of
      crashing (confirmed live, before and after). (2) Leaflet's own popup CSS
      (`.leaflet-popup-content-wrapper, .leaflet-popup-tip { background: white; color:
      #333 }`) is injected AFTER globals.css (it ships inside the lazy-loaded LeafletMap
      chunk by design), so a same-specificity override loses the cascade tie regardless of
      source order — the popup was rendering illegibly in dark mode (dark text on a white
      wrapper that never actually retinted). Rewrote every override to a
      `.leaflet-container <selector>` descendant form (specificity (0,2,0) vs Leaflet's
      (0,1,0)/(0,1,1)) so it wins regardless of injection order; reverified via
      `getComputedStyle` in both themes (light: white/near-black; dark: dark-gray/near-
      white — both matching `--popover`/`--popover-foreground` exactly) before reverting
      the temporary hardcoded-coordinates test harness used to drive that check. 315 tests
      green (no regression; no new standalone pure logic needing tests — the per-property
      unit/ticket aggregation is inlined in the page, mirroring the existing convention in
      the property/unit hub pages, none of which unit-test their inline aggregations
      either). Migration 0024 still needs a USER to run it (already queued from M1) before
      any real pins can appear — M3 is the right place to verify that end-to-end once it
      has.)*

- [ ] **M3** `[verify]` — Map verification. **Depends: M2 + USER ran 0024.** Playbook:
      create a property with a real Vienna address → pin appears; edit address → pin
      moves or clears; backfill locates seeded properties; popups navigate; dark mode
      legible; phone viewport pans; zero CSP violations (OSM tiles are pre-allowed in
      the S1.1 CSP).

## Track P — Product depth (each needs a spec before code)

- [ ] **P1** `[plan]` — Tenant directory. Brainstorm → spec → split into board tasks.
      Outline: roadmap v2 §4. PII SELECT gating mirrors tenancies (0016).
- [ ] **P2** `[plan]` — In-app notifications. Outline: roadmap v2 §4. Delete
      `/preview/notifications` when real one ships.
- [ ] **P3** `[plan]` — Recurring rent invoices. Outline: roadmap v2 §4 (no cron —
      "Generate month" button). Delete `/preview/rent-automation` when shipped.
- [ ] **P4** `[plan]` — German i18n via next-intl (second approved dependency,
      cookie-based locale). LAST — after P1–P3 so screens are stable.

## Track S2 — Security deep (after P2)

- [ ] **S2-1** `[plan]` — TOTP MFA enrollment (`/settings/security`) + soft-enforce
      for OWNER. Spec section exists (security design §S2.1) but needs a UI design
      pass before building.
- [ ] **S2-2** `[builder]` `[rls]` — `auth_events` audit table + writes from auth
      actions + admin table on `/settings/security`. Spec §S2.2.
- [ ] **S2-3** `[builder]` — CSP: flip Report-Only → enforcing. **Blocked on USER
      confirming zero violations in normal browsing for a few days.** One-line header
      rename in `next.config.ts`.
- [ ] **S2-4** `[builder]` — `npm audit` script + monthly dependency runbook entry.

## Perf

- [ ] **PERF-1** `[plan]` — Kill the double `auth.getUser()` per navigation (middleware
      + page both hit Supabase Auth over the network; React `cache()` doesn't span
      runtimes). **High-stakes: this is the auth boundary — design pass required, no
      direct implementation.** Context: memory notes 2026-07-09 session 6.
- [ ] **PERF-2** `[builder]` — Add `@vercel/speed-insights` for a real-user metrics
      baseline (tiny; then decide what else is worth doing with data, not vibes).

## Housekeeping (continued)

- [x] **H2** `[builder]` — Sync `.env.local.example` with reality (flagged by the
      S3-1 build): it's missing `SIGNUP_MODE`, `DEMO_MODE`, `DEMO_WORKSPACE_ID`,
      `ANTHROPIC_API_KEY`, `ANTHROPIC_TRIAGE_MODEL`. Ground truth = the env matrix in
      `docs/runbooks/self-hosting.md` (which was grepped from source). Placeholder
      values + one-line comments only — never real keys.

## Housekeeping

- [ ] **H1** `[builder]` — Delete dead `src/components/common/DataTable.tsx` (nothing
      imports it). One-line commit.

---

## USER-action queue (humans only — agents must never attempt these)

- [ ] Verify migration **0021** applied (`select column_name from
      information_schema.columns where table_name='invoices' and
      column_name='recipient_email';` — one row = done).
- [ ] Run migration **0022** (rate limiting) in the Supabase SQL editor. Until then
      the limiter fails open (app works, no throttling).
- [ ] Run migration **0023** (demo mode) — after/with D2–D5 landing.
- [ ] Run migration **0024** (properties lat/lng/geocoded_at — Track M) in the Supabase
      SQL editor. Additive, nullable columns only, no RLS/policy change. Until applied,
      both call sites degrade safely with no user-facing failure: geocode-on-save's
      `.update({latitude, longitude, geocoded_at})` targets columns that don't exist
      yet, so PostgREST errors and `refreshPropertyGeocode`'s try/catch swallows it
      (property saves are unaffected either way); the backfill action's `select('*')`
      simply won't return those keys, so every property reads as `latitude: undefined`
      — which fails its `=== null` "missing coords" check — so backfill finds zero
      properties to geocode and no-ops (0 Nominatim calls) rather than erroring.
- [ ] Supabase dashboard → Auth → Providers → enable **Anonymous sign-ins** (demo).
- [ ] Vercel env (Production) + `.env.local`: `SIGNUP_MODE=invite` (flips the front
      door — do this deliberately), `DEMO_MODE=on`,
      `DEMO_WORKSPACE_ID=11111111-1111-1111-1111-111111111111`. Redeploy after.
- [ ] Work through `docs/runbooks/supabase-security-settings.md` (leaked-password
      protection, session lifetimes, OTP expiry, redirect allowlist).
- [ ] After a few days of clean browsing: green-light S2-3 (CSP enforce).
