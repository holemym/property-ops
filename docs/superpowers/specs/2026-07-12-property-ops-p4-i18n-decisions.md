# P4 — German i18n — Locked decisions (decomposition deferred)

**Date:** 2026-07-12 · **Status:** decisions approved; task decomposition
INTENTIONALLY deferred until P1–P3 ship (the screen inventory these tasks would
enumerate is still growing — decomposing now would guarantee churn). When P1–P3 are
done, a planning session turns this into P4-1..P4-n board tasks mechanically — the
hard choices are made here.

## Locked decisions (do not relitigate at build time)

1. **Library: `next-intl`** (the second and final pre-approved dependency alongside
   leaflet). Hand-rolled i18n is exactly where weaker models drift; next-intl is the
   App-Router-native standard with first-class RSC support.
2. **No URL-prefix routing.** Locale via **cookie** (`NEXT_LOCALE`), default `en`.
   Every existing URL, bookmark, vendor job link, and email link keeps working; no
   middleware routing changes (proxy.ts stays focused on auth). Switcher = a small
   select in the TopNav account dropdown, writing the cookie via a server action.
3. **Languages: `en` (source of truth) + `de`.** Austrian German in tone ("Sie"
   form, Austrian domain vocabulary where it differs — e.g. "Kaution", "Betriebskosten"
   if/where those concepts appear).
4. **Message organization:** `messages/en.json` + `messages/de.json`, namespaced by
   surface (`nav`, `dashboard`, `tickets`, `finance`, …) mirroring the route groups —
   NOT per-component files (too granular to keep the two languages honest).
5. **What does NOT get translated:** enum VALUES stored in the DB (statuses stay
   `RESOLVED` etc. in data; their LABELS translate via the existing
   `statusBadge`/humanize helpers which become locale-aware), invoice/email documents
   sent to external parties (stay English v1 — a per-recipient language feature can
   key off P1's `tenants.language` later, noted not built), log/error strings in
   server code, the demo seed data.
6. **Dates/numbers:** the UTC-pinning and hydration-safety rationale of
   `src/lib/format-date.ts` is preserved — it gains a locale parameter fed by
   next-intl's active locale (`de-AT` ↔ `en-IE`), same for the money formatters.
   The en-IE/de-AT switch changes RENDERING only, never stored values.
7. **Tenant portal translates first** in the eventual task order (highest value —
   tenants are the least likely to read English), then nav/shell, then operator
   surfaces, then edge surfaces (print/email previews last, still English if time).
8. **Copy freeze discipline:** during P4 execution, other tracks must not add new
   user-facing strings outside the message files — the P4 kickoff task adds a lint
   note to the board header.

## Why deferred, restated for the future planner

P1 (People), P2 (Notifications), P3 (rent dialog + overdue chips) each add whole
screens of copy. Extracting strings twice is pure waste; extract once, after.
