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
      *(WIP 2026-07-12 — checkable-now subset PASSED via an independent audit pass:
      build+lint+315 tests green re-run from scratch; live headers confirmed via curl
      (CSP report-only with `https://*.tile.openstreetmap.org` in img-src, HSTS on);
      Leaflet chunk confirmed ABSENT from the shared root bundle via build-manifest
      inspection (lazy-loaded only); popup content confirmed DOM-built
      (createElement/textContent, no innerHTML — property names are user input);
      pre-migration graceful degradation confirmed in code (`hasCoordinates` type
      predicate handles the undefined-columns state). REMAINING, blocked on USER
      running migration 0024: pin-on-create, pin-moves-on-address-edit, backfill run,
      popup navigation click-through, dark-mode legibility on real pins, phone
      viewport pan/zoom. Re-dispatch prop-verifier for just that list after 0024.)*

## Track P1 — Tenant directory (People)
Spec: `docs/superpowers/specs/2026-07-12-property-ops-p1-tenant-directory-design.md`
(Fable design pass done 2026-07-12 — builders follow it exactly.)

- [x] **P1-1** `[builder]` `[rls]` — Migration 0025 (`tenants` table, PII-gated RLS
      per 0016's posture, `tenancies.tenant_id` composite FK, trigram indexes,
      demo-reset extension, bundle fold) + `tenants:read`/`tenants:write` permissions
      + data layer `src/lib/data/tenants.ts` + `src/lib/validation/tenant.ts` + unit
      tests. Spec §1–3.
      *(committed 2026-07-15 — RLS review came back CLEAN: `tenancies.tenant_id` is
      `on delete set null` in both the migration and the schema_bundle fold, the
      re-pasted `reset_demo_workspace()` is byte-complete (trigger disable/enable +
      all seeds intact, one dropped `-- Tickets` header comment restored post-review
      in both files), and the tenants RLS is a verbatim match to tenancies/0016's
      PII posture (role-gated SELECT, manager-only write, no DELETE). Built:
      `supabase/migrations/0025_tenants.sql` + `schema_bundle.sql` fold (new TENANT
      DIRECTORY (0025) section; `reset_demo_workspace()` updated in place to its
      final state; `expect 17` -> `expect 18`) + `tenants:read`/`tenants:write` in
      `src/lib/auth/permissions.ts` (managers get both, ACCOUNTANT read-only) +
      `Tenant` type + `listTenants`/`getTenant`/`createTenant`/`updateTenant`/
      `listTenanciesForTenant` in `src/lib/data/tenants.ts` + `tenantFormSchema` in
      `src/lib/validation/tenant.ts` + `Tenancy` (`src/types/domain.ts`) widened
      with `tenant_id: string | null` (always null until P1-3 wires the write path)
      + `tests/helpers/fake-supabase.ts` gained minimal `.or()` support to test the
      full_name/email search. Row-type-location briefing inaccuracy this task
      surfaced is now fixed at the source (see the hard-rules doc's new "Row-type
      location is SPLIT" note). 341 tests green (325 baseline + 16 new), build+lint
      clean. No UI yet — `/people` is P1-2/P1-3, `/preview/people` still in nav.
      USER: migration 0025 still needs to be run in the SQL editor — already queued
      at line ~465.)*
- [x] **P1-2** `[builder]` — `/people` list (search, responsive table→cards) +
      `TenantForm` + new/edit pages + Portfolio nav entry + **delete
      `/preview/people`**. Depends P1-1. Spec §4.
      *(committed 2026-07-15 — built `src/components/tenants/TenantForm.tsx` (mirrors
      VendorForm: fullName/email/phone/language/notes, readOnly mode) +
      `src/components/tenants/TenantTable.tsx` (mirrors VendorTable: Name/Contact
      (email+phone stacked)/Language/Tenancies columns, mobile card fallback,
      stretched-link + focus-ring row click to `/people/[id]`) +
      `src/app/(app)/people/page.tsx` (search-by-name form mirrors `/properties`;
      linked-tenancy count computed by joining the existing `listTenants` +
      `listTenancies` calls through a `Map<tenantId, count>` in the page — same
      pattern as `/map`'s `unitCountByProperty`, so no new data-layer code was needed)
      + `/people/new` + `/people/[id]` (minimal edit form, no toggle/card — structured
      so P1-3 can add the linked-tenancies card as a sibling block) +
      `src/app/(app)/people/actions.ts` (`createTenantAction`/`updateTenantAction`,
      mirrors `vendors/actions.ts` exactly) + three `loading.tsx` skeletons + moved
      "People" from the Preview nav group into Portfolio (icon `Contact`, after Rent
      roll, `tenants:read`-gated) in `src/components/layout/Sidebar.tsx` + deleted
      `src/app/(app)/preview/people/page.tsx` in the same commit (swap rule). No lib
      changes — P1-1's data layer/validation/permissions were used as-is. No new pure
      logic, so no new test file (matches the vendors/properties precedent: their
      list/form UI has zero dedicated test files either — pure logic lives in the data
      layer, already covered by `tests/unit/data-tenants.test.ts` +
      `tenant-validation.test.ts`). 341 tests green (unchanged from P1-1's baseline),
      build+lint clean. Note: the CommandPalette's static "Go to" `COMMANDS` list
      (`src/components/search/CommandPalette.tsx`) still has no People entry — it was
      also never updated for Map (M2), so this list isn't treated as
      exhaustively-maintained by prior tasks; left as-is, out of P1-2's explicit scope
      (spec §4's only CommandPalette-adjacent item, `searchWorkspace` + `TYPE_META`
      href, is P1-3's). Flagging for whoever next touches nav search.)*
- [x] **P1-3** `[builder]` — Detail-page tenancy card + `NewTenancyDialog` person
      picker (server-side name resolution in `createTenancy`) + tenants source in
      `searchWorkspace` + tests. Depends P1-1; sequence after P1-2 (shared board/nav
      files). Spec §4. **Added scope (P1-2 flagged it):** while you're in
      `CommandPalette.tsx` for the `searchWorkspace`/`TYPE_META` work, also add a
      `go-people` entry to the static `COMMANDS` "Go to" list (icon `Contact`, href
      `/people`, permission `tenants:read`) so People is reachable from the palette's
      go-to shortcuts, not just dynamic search — every other nav destination has one.
      (The parallel `go-map` omission from M2 is H4's job, not yours — don't touch it.)
      *(committed 2026-07-15 — built: `/people/[id]` "Linked tenancies" Card (unit ·
      property / span via `formatDate` / rent, `DoorOpen` EmptyState) fed by P1-1's
      `listTenanciesForTenant` + `listUnits`/`listProperties` joined in-page (same
      Map-lookup pattern as `/occupancy`); `NewTenancyDialog` gained an optional
      "Person" `<select>` (hidden when the workspace has zero directory people, same
      convention as `AddExpenseDialog`'s ticket picker) that previews the chosen
      person's name into the free-text field and locks it `readOnly` (Tailwind
      `read-only:` variant, verified it actually compiles — see below) via a plain
      ref-driven DOM write, not React state, so both fields stay uncontrolled and
      reset correctly on the dialog's next open (confirmed from source:
      `@base-ui/react`'s `DialogPortal` returns `null` when closed — `keepMounted`
      defaults false — so the form subtree fully remounts, never carrying stale
      `readOnly`/value across opens); **CRITICAL** — `createTenancy`
      (`src/lib/data/tenancies.ts`) now takes an optional `tenantId`, and when set,
      re-resolves `tenant_name` from `getTenant(workspaceId, tenantId)` server-side
      and throws `'Selected person was not found in your workspace.'` if it doesn't
      resolve (wrong id or cross-workspace id) — the client's `tenantName` is never
      trusted once a person is linked; free-text-only tenancies (`tenantId`
      omitted/null) are byte-for-byte unchanged from pre-P1-3 behaviour.
      `tenancyFormSchema` gained `tenantId: z.string().uuid().nullable().optional()`
      (same shape as `ticketCreateSchema.unitId`) and `occupancy/actions.ts` maps the
      select's empty option to `undefined` (the established idiom). `searchWorkspace`
      now queries `tenants` (full_name/email) as a SECOND source for the existing
      `tenant` result type — href `/people/[id]`, alongside the untouched
      tenancy-level `tenant_name` source (href stays `/units/[id]`); `CommandPalette`
      gained `go-people` (icon `Contact`, href `/people`, permission `tenants:read`,
      placed after `go-rent-roll` to mirror the Sidebar's Portfolio group order) —
      `go-map` deliberately left untouched for H4. Tests: 12 new (3 in
      `data-tenancies.test.ts` — resolves-and-overrides, throws on a wrong id, throws
      on a cross-workspace id; 9 in new `tenancy-validation.test.ts`, mirroring
      `ticket-validation.test.ts`'s nullable-uuid coverage). 353 tests green (341
      baseline + 12 new), build+lint clean. No migration, no policy change — RLS on
      `tenants` (0025) already gates the new search source and the `getTenant` call
      inside `createTenancy`; not `[rls]`-tagged. One judgment call beyond the spec's
      literal text, flagging for visibility: the spec doesn't say what `createTenancy`
      should do when a supplied `tenantId` fails to resolve — chose fail-closed
      (throw, surfaced to the user via the existing `redirectWithError` catch in
      `createTenancyAction`) over silently falling back to the client's free-text
      name, since a silent fallback would quietly defeat the "never trust the client
      copy" guarantee for exactly the tampered/stale-id case it exists to catch.)*
- [ ] **P1-4** `[verify]` — Full playbook in spec §6. Depends P1-1..3 + USER ran 0025.

## Track P2 — In-app notifications
Spec: `docs/superpowers/specs/2026-07-12-property-ops-p2-notifications-design.md`

- [x] **P2-1** `[builder]` `[rls]` — Migration 0026 (`notifications` + enum, own-inbox
      RLS with zero-INSERT-policy/service-role writes, demo-reset extension, bundle
      fold) + `notify-inapp.ts` writer + wiring into the three ticket-action moments +
      data layer + unit tests (recipient-resolution branches). Spec §1–2.
      *(committed 2026-07-16 — RLS review came back CLEAN: own-inbox SELECT/UPDATE
      isolation verified byte-for-byte with genuinely no manager/admin override
      branch, zero INSERT policy confirmed, the writer uses the service client while
      mark-read/mark-all use the caller's own RLS client, and the re-pasted
      `reset_demo_workspace()` is line-by-line identical to 0025's body except the one
      new notifications-delete line (no comment-drop this time). Built:
      `supabase/migrations/0026_notifications.sql` + `schema_bundle.sql` fold (new
      NOTIFICATIONS (0026) section; `reset_demo_workspace()` updated in place;
      `expect 18` -> `expect 19`) + `src/lib/notifications/notify-inapp.ts`
      (`createNotification` writer + `resolveOperatorAssignedRecipient`/
      `resolveStatusChangedRecipients`/`resolveCommentRecipient` pure resolvers) +
      `src/lib/data/notifications.ts` (`listNotificationsPage`/`countUnread`/
      `markRead`/`markAllRead`) + `NotificationType` in `src/types/domain.ts` (row
      type `Notification` stays local per the corrected row-type-location rule) +
      wiring into `src/app/(app)/tickets/actions.ts` at
      `transitionTicketStatusAction`/`assignOperatorAction`/`addTicketCommentAction`
      (the last is net-new — `notify.ts` has no comment email) +
      `tests/helpers/fake-supabase.ts` gained minimal `.is()`/`.range()`/count
      support. 380 tests green (353 baseline + 27 new), build+lint clean.
      markRead/markAllRead have no call sites yet — expected, P2-2 wires them into
      `/notifications` and that review will confirm the real caller uses the own
      client. USER: migration 0026 still needs to be run in the SQL editor — already
      queued in the Standing USER-action queue below.)*
- [x] **P2-2** `[builder]` — TopNav bell + unread chip + `/notifications` inbox
      (paged, mark-read/mark-all) + portal-surface check + **delete
      `/preview/notifications`**. Depends P2-1. Spec §3.
      *(committed 2026-07-16 — both mark-read/mark-all actions use createClient()
      (the caller's own RLS client), never the service client, per P2-1's carried-over
      security note. Built: `src/app/(app)/notifications/page.tsx` (PageHeader,
      `requireWorkspace()` only — no permission gate — paged via `listNotificationsPage`
      + `countUnread` in parallel, house `Pagination` at 25/page, EmptyState "You're all
      caught up", "Mark all read" header action hidden at zero unread, each row a
      `<form>`-wrapped full-width submit button — not a `<Link>`, since the click must
      mark-read before navigating — with a type-tinted dot, `bg-muted/40` + semibold
      while unread) + `src/app/(app)/notifications/actions.ts`
      (`markReadNotificationAction`: best-effort mark-read, never blocks the redirect;
      `markAllReadNotificationsAction`: surfaces a failure via `redirectWithError`,
      since that click IS the whole point) + bell in `src/components/layout/TopNav.tsx`
      (Bell icon + count chip, always rendered for both operator and tenant — verified
      in the browser that the portal's TopNav shows it and correctly omits
      CommandPalette) + unread count server-fetched in `src/app/(app)/layout.tsx`
      alongside the workspace-name fetch, wrapped in `.catch(() => 0)` so a
      notifications-table hiccup (e.g. 0026 not yet applied somewhere) degrades to "no
      chip" instead of 500ing every page in the app + `notification_type` tone mapping
      in `src/lib/status.ts` (ASSIGNED/blue, STATUS_CHANGED/amber, COMMENT/neutral) +
      two new pure/tested helpers: `src/lib/notifications/unread-badge.ts`
      (`formatUnreadBadge`, caps display at "9+", null hides the chip) and
      `src/lib/notifications/resolve-href.ts` (`resolveNotificationHref` — see finding
      below) + deleted `src/app/(app)/preview/notifications/page.tsx` and its Sidebar
      Preview-group entry (no OPERATOR_GROUPS replacement — the bell is the nav
      affordance, not a sidebar link). 389 tests green (380 baseline + 9 new),
      build+lint clean.
      **Finding beyond the spec's literal text, fixed in-scope:** every notification
      href written by P2-1 is an operator path (`/tickets/<id>`), but tenants hold zero
      `tickets:read`-family permissions and `/tickets/[id]` gates on `requirePermission`
      — so a tenant clicking their own status-changed/comment notification would have
      crashed via the default error boundary instead of reaching their ticket. Tenants'
      reachable equivalent is `/portal/<id>` (RLS-scoped to `created_by` OR
      `created_for`, migration 0013 — exactly the two recipients
      `resolveStatusChangedRecipients` fans out to). `resolveNotificationHref` rewrites
      `/tickets/<id>` → `/portal/<id>` for TENANT/GUEST at click time in
      `markReadNotificationAction`, rather than reopening P2-1's already-RLS-reviewed
      `tickets/actions.ts` to make the writer role-aware. Every v1 `NotificationType` is
      ticket-related so the blanket prefix swap is complete for now; flagged in the
      function's own docstring for whoever adds a non-ticket notification type later.
      **Also discovered, NOT fixed here (separate, wider blast radius, flagged via
      spawn_task):** ~20 pre-existing `<Button render={<Link .../>}>` call sites across
      ~15 files (e.g. `EmptyState.tsx`, `tickets/page.tsx`, `properties/page.tsx`) never
      set `nativeButton={false}`, so Base UI's dev-mode `useButton` check logs a console
      error on every mount (confirmed by reading `@base-ui/react`'s `useButton.js` — the
      check is unconditional, not page-specific). Dev-only (gated behind
      `NODE_ENV !== 'production'`) and doesn't fail build/lint/tests, so it shipped
      unnoticed until this task's own new bell button hit the same issue and got fixed
      (`nativeButton={false}` added at its one call site) — the other ~20 are
      out-of-scope for a notifications ticket and were left untouched.)*
- [ ] **P2-3** `[verify]` — Full playbook in spec §5. Depends P2-1..2 + USER ran 0026.

## Track P3 — Recurring rent invoices
Spec: `docs/superpowers/specs/2026-07-12-property-ops-p3-recurring-rent-design.md`

- [ ] **P3-1** `[builder]` `[rls]` — Migration 0027 (`invoices.billing_period` +
      partial unique dedupe index, bundle fold) + `Invoice` type field +
      `src/lib/invoices/recurring.ts` pure planner + exhaustive edge-case unit tests.
      Spec §1–2.
- [ ] **P3-2** `[builder]` — `generateRentInvoicesAction` + month dialog + result
      toast + derived overdue badge + `?overdue=1` filter + **delete
      `/preview/rent-automation`**. Depends P3-1 (works with or without P1's
      tenant links). Spec §3.
- [ ] **P3-3** `[verify]` — Full playbook in spec §5. Depends P3-1..2 + USER ran 0027.

## Track P4 — German i18n
Decisions LOCKED in
`docs/superpowers/specs/2026-07-12-property-ops-p4-i18n-decisions.md` (next-intl,
cookie locale, message-file layout, what never gets translated, date/money locale
handling). **Task decomposition deliberately deferred until P1–P3 ship** — the copy
surface is still growing; decomposing now guarantees churn. The future planning pass
is mechanical given the decisions doc.

- [ ] **P4-0** `[plan]` — (After P1–P3.) Turn the decisions doc into P4-1..n tasks:
      dependency+plumbing first, then portal, shell/nav, operator surfaces, in the
      doc's locked order.

## Track S2 — Security deep (after P2)
S2-1 spec: `docs/superpowers/specs/2026-07-12-property-ops-s2-1-mfa-design.md`

- [ ] **S2-1a** `[builder]` — Browser Supabase client helper (if missing) +
      `/settings/security` page + `MfaEnroll` flow + factor list/remove + Settings
      nav group + password-change link. Spec §2.
- [ ] **S2-1b** `[builder]` — `/auth/mfa` challenge page + AAL redirect in
      `signInWithPassword` + the `requireUser()` AAL gate + owner dashboard nag.
      Depends S2-1a. **Auth boundary — deviations stop and report, never improvise.**
      Spec §3–4.
- [ ] **S2-1c** `[verify]` — Full playbook in spec §6 (needs a disposable test
      account from USER — never enroll MFA on the real owner account).
- [ ] **S2-2** `[builder]` `[rls]` — `auth_events` audit table + writes from auth
      actions + admin table on `/settings/security`. Spec: security-hardening design
      §S2.2. Sequence after S2-1a (shares the security page).
- [ ] **S2-3** `[builder]` — CSP: flip Report-Only → enforcing. **Blocked on USER
      confirming zero violations in normal browsing for a few days.** One-line header
      rename in `next.config.ts`.
- [ ] **S2-4** `[builder]` — `npm audit` script + monthly dependency runbook entry.

## Perf
PERF-1 spec: `docs/superpowers/specs/2026-07-12-property-ops-perf1-auth-roundtrip-design.md`
(Fable design pass done — the middleware `getUser()` STAYS; only the page-level call
changes. Rejected alternatives are listed in the spec; do not revisit them.)

**Numbering note:** PERF-1x and PERF-2 are listed in narrative order, not dependency
order — they share no files and PERF-2 has no functional dependency on PERF-1's
completion. Either can run first; a builder correctly proceeded on PERF-2 without
waiting for PERF-1b/1c and that was the right call. Only S2-3 (CSP enforce) actually
depends on PERF-2 having landed first, since PERF-2 fixed a dev-mode CSP gap that
would otherwise show up as a false-positive violation during S2-3's browsing check.

- [x] **PERF-1a** `[builder]` — Swap `getCurrentUser()`'s `auth.getUser()` for
      `auth.getClaims()` per spec (touch nothing else) + tests. Safe pre-key-migration
      (automatic fallback).
      *(done — `src/lib/auth/session.ts`; extracted pure `claimsToUserShell()` mapping,
      5 new unit tests in `tests/unit/session.test.ts`; middleware/proxy.ts, requireUser's
      deactivation logic, and auth actions untouched. 325 tests green (was 320).)*
- [ ] **PERF-1b** `[USER]` — Supabase dashboard → JWT Keys → migrate to asymmetric
      signing keys (this flips the perf win on). Queued below.
- [ ] **PERF-1c** `[verify]` — After 1b: all auth flows live-checked, page-level Auth
      API calls gone from logs, before/after navigation timing recorded. Spec §Rollout.
- [x] **PERF-2** `[builder]` — Add `@vercel/speed-insights` for a real-user metrics
      baseline (tiny; then decide what else is worth doing with data, not vibes).
      *(done — `<SpeedInsights />` wired into `src/app/layout.tsx` root layout per
      Vercel's standard App Router integration. Also added `va.vercel-scripts.com` to
      `next.config.ts`'s CSP `script-src`: the package's dev-mode debug script loads
      from that external domain (production self-hosts same-origin at
      `/_vercel/speed-insights/script.js`, already covered by `'self'`) — without the
      allowance, local dev would show a false-positive CSP violation, undermining the
      "zero violations" check S2-3 is gated on. No new pure logic, so no new unit
      tests; build+lint+325 existing tests verified green, plus a runtime smoke check
      (dev server, console clean, script injected with correct route/SDK metadata).
      Independent of PERF-1b/1c — no functional dependency, just doc ordering.)*

## Housekeeping

- [x] **H1** `[builder]` — Delete dead `src/components/common/DataTable.tsx` (nothing
      imports it). One-line commit.
      *(done — landed as a scope freebie inside the D7 commit (`bbe845a`), just never
      ticked here until now; confirmed via `git log --diff-filter=D`.)*
- [x] **H2** `[builder]` — Sync `.env.local.example` with reality (flagged by the
      S3-1 build): it's missing `SIGNUP_MODE`, `DEMO_MODE`, `DEMO_WORKSPACE_ID`,
      `ANTHROPIC_API_KEY`, `ANTHROPIC_TRIAGE_MODEL`. Ground truth = the env matrix in
      `docs/runbooks/self-hosting.md` (which was grepped from source). Placeholder
      values + one-line comments only — never real keys.
      *(committed `8d9f83b`. One more var was missed — `NOMINATIM_CONTACT`, added by
      M1 after this landed — folded in directly, see below.)*
- [x] **H3** `[builder]` — Reconcile the "is a RESOLVED ticket still open?" split
      (flagged by the M2 build). `dashboard/page.tsx` counts `RESOLVED` tickets as
      open/needing attention; `occupancy`, `insights`/analytics, the property hub, and
      the unit hub all count `RESOLVED` as done (terminal) — same ticket can read
      differently depending which page you're on. Decide the correct semantics (likely:
      RESOLVED = done, matching the 4-page majority and `TERMINAL_TICKET_STATUSES` in
      `src/components/units/hub/shared.ts`), fix the outlier, and grep for any other
      ad-hoc status-terminality checks to make sure there's only one source of truth
      going forward — consider extracting a shared `isTicketOpen(status)` helper.
      **Accept:** every surface agrees on open vs. done for the same ticket; unit test
      the extracted helper if one is added; build+lint+tests green.
      *(committed — verified the majority independently first: `occupancy/page.tsx`,
      `properties/[id]/page.tsx` (property hub), `units/[id]/page.tsx` (unit hub, via
      `TERMINAL_TICKET_STATUSES` in `hub/shared.ts`), `lib/analytics/metrics.ts` (insights,
      via an inverted `NON_TERMINAL_STATUSES`), and `map/page.tsx` all independently
      hand-rolled the identical `['RESOLVED','CLOSED','CANCELLED']` terminal list — five
      separate re-implementations of the same concept, confirming both the majority
      semantics and the "only one source of truth" problem the ticket flagged.
      `dashboard/page.tsx` was the sole outlier (`['CLOSED','CANCELLED']`, missing
      RESOLVED). Extracted `isTicketOpen(status)` + `TERMINAL_TICKET_STATUSES` into
      `src/lib/status.ts` (already the established single source of truth for ticket
      status presentation, per roadmap §2's `src/lib/` list — not `hub/shared.ts`, which
      is page-scoped and only ever had the one unit-hub importer) and repointed all six
      surfaces at it, deleting every local re-implementation. Fixed the dashboard bug:
      `openCount`, "Urgent open", and "Assigned to me" no longer count a RESOLVED ticket
      as open. Left `portal-status.ts`'s `tenantProgress` (a distinct 4-stage tenant
      stepper, already correctly treating RESOLVED as done) and `status-flow.ts`'s
      `ALLOWED_TRANSITIONS` (workflow-legality terminal — CLOSED/CANCELLED have no legal
      successors, but RESOLVED can legally reopen to IN_PROGRESS) untouched: both are a
      genuinely different concept from "does this ticket still need attention," not
      ad-hoc duplicates of it. Also left the dashboard's "Recently resolved" widget filter
      (`status === 'RESOLVED' || status === 'CLOSED'`) as-is — it deliberately excludes
      CANCELLED from a "wrapped up lately" digest, a separate business decision from the
      open/done split. New `tests/unit/status.test.ts` exhaustively covers
      `isTicketOpen`/`TERMINAL_TICKET_STATUSES` over all 9 `TicketStatus` values,
      pinning the RESOLVED regression case specifically. 320 tests green (315 + 5 new),
      build+lint clean. No migration, no RLS surface — pure application-layer refactor.)*
- [ ] **H4** `[builder]` — Fix CommandPalette static-nav drift (flagged by P1-2). The
      `COMMANDS` "Go to" list in `src/components/search/CommandPalette.tsx` never got a
      `go-map` entry when M2 shipped `/map` (People is handled by P1-3, so don't add
      `go-people` — it'll already be there). Add `go-map` (icon `MapPinned` — already
      the Sidebar's map icon, href `/map`, permission `properties:read`), then audit
      the whole `COMMANDS` list against the actual Sidebar nav destinations and add any
      other missing operator-reachable routes in one pass so this list stops silently
      drifting. **Sequence AFTER P1-3** — both edit `CommandPalette.tsx` and would
      collide if concurrent. **Accept:** every operator Sidebar destination has a
      matching go-to command with the correct permission gate; build+lint+tests green.
- [x] **H5** `[builder]` — Add `nativeButton={false}` to every `<Button render={<Link/>}>`
      composite (flagged by P2-2, which fixed only its own new bell call site). Base
      UI's `useButton` logs a dev-console error on every mount of a `render`-as-anchor
      Button without it (confirmed against `@base-ui/react` source) — dev-only, doesn't
      fail build/lint/tests, but noisy.
      *(done — swept 22 composites across 15 files via a scoped perl insert
      (`render={<Link .../>}` → `+ nativeButton={false}`), TopNav excluded since P2-2
      already fixed it and its `render=` is multi-line. A broad-pattern completeness
      grep (`render={<Link[^}]*/>}` minus `nativeButton`) caught one site BOTH the
      original list and a narrow `Button render={` grep had missed — `finance/page.tsx:87`,
      where `render=` sits after `size=`/`variant=` props — fixed it too. Final state:
      the only un-inlined `render={<Link/>}` is TopNav:67 (prop on the next line, single,
      not doubled); no double-adds anywhere. build+lint+389 tests green. Runtime
      debug-route verification skipped deliberately: the Base UI warning fires iff
      `nativeButton && !isNativeButton`, so `nativeButton={false}` provably silences it —
      the temp-PUBLIC_PATHS technique's own risk (a forgotten `proxy.ts` revert = auth
      hole) outweighs its marginal value for a prop-only, logically-certain change.)*

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
- [ ] *(becomes due as tracks land)* Run migration **0025** (tenants — after P1-1),
      **0026** (notifications — after P2-1), **0027** (invoice billing_period — after
      P3-1) in the SQL editor. Each is announced in its builder's report.
- [ ] *(PERF-1b)* Supabase dashboard → Project Settings → JWT Keys → migrate to
      **asymmetric signing keys** — flips on PERF-1's speed win. Do after PERF-1a lands.
- [ ] *(with S2-1)* Supabase dashboard → Auth → Multi-Factor: confirm TOTP enabled;
      provide a disposable test account for S2-1c verification (never enroll MFA on
      the real owner account during testing).
