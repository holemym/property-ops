# PERF-1 — Kill the duplicate auth round-trip per navigation — Design

**Date:** 2026-07-12 · **Status:** approved (Fable design pass) · **Risk class: HIGH —
this is the authentication boundary.** Builders implement EXACTLY this design; any
deviation stops and reports instead of improvising.

## The problem (measured, not guessed)

Every authenticated navigation today makes **three serial network calls** before the
page's own data loads:

1. `src/proxy.ts` → `updateSession()` → `supabase.auth.getUser()` — network hit to
   Supabase Auth (Edge runtime). Seen at ~66ms in Vercel logs.
2. Page render → `getCurrentUser()` (`src/lib/auth/session.ts`) →
   `supabase.auth.getUser()` **again** — the React `cache()` wrapper dedupes within the
   Node runtime only; it cannot span the middleware/page runtime boundary.
3. The `profiles` SELECT (role/workspace/is_active).

Call #2 is pure waste *provided* the token's authenticity can be established without a
network round-trip. That is exactly what asymmetric JWT verification gives us.

## The design

**Keep** the middleware `getUser()` untouched. It is load-bearing twice over: it
triggers token refresh with cookie write-back (only middleware can reliably set
cookies in this architecture) and it gives per-request revocation freshness at the
outer gate.

**Replace** the page-level `getUser()` inside `getCurrentUser()` with
`supabase.auth.getClaims()` — local cryptographic verification of the access token's
signature against the project's JWKS (fetched once, cached by the SDK). With
asymmetric signing keys enabled on the Supabase project, this is **zero network**.
The SDK is already new enough (`@supabase/supabase-js ^2.110`, `getClaims` present —
verified in `node_modules`).

**Keep** the `profiles` SELECT exactly as is — it carries `role`/`workspace_id`/
`is_active`, which the JWT does not, and the app-layer `is_active` deactivation gate
in `requireUser()` depends on it. Net effect: 3 serial auth-path calls → 2, and the
one removed is the redundant serial Auth round-trip.

### Why this is safe (the part that made it a Fable design)

- **Defense in depth is preserved, not thinned.** The CVE-class risk of trusting
  middleware alone (requests reaching pages without middleware) does not apply:
  `getClaims()` cryptographically verifies the token *in the page itself*; a forged or
  expired token fails signature/`exp` validation locally. And even a hypothetical
  bypass of BOTH gates still hits RLS — PostgREST independently verifies the JWT on
  the `profiles` SELECT and every later query.
- **Revocation window is unchanged in practice.** A revoked-but-unexpired token is
  caught by the middleware `getUser()` on every request (kept), same as today. The
  page-level check was never the revocation gate.
- **Deactivation is unchanged.** `is_active` comes from the profiles row (kept) and is
  enforced in `requireUser()` (untouched).
- **Graceful degradation.** On a project still using the legacy symmetric JWT secret,
  `getClaims()` falls back to a server-side verification call — correctness identical,
  perf win simply deferred until the key migration (USER action below).

### Implementation (one builder task)

In `src/lib/auth/session.ts`, inside the `cache()`-wrapped `getCurrentUser()` only:

```ts
const { data: claimsData, error } = await supabase.auth.getClaims()
const claims = claimsData?.claims
if (error || !claims?.sub) return null
// then the existing profiles SELECT keyed on claims.sub instead of user.id
```

- `email` comes from `claims.email ?? ''` (same fallback semantics as today).
- **Touch nothing else.** Not `updateSession()`, not `proxy.ts`, not the auth actions
  (`signOut`/`setPassword`/etc. keep their own flows), not `requireUser()`'s
  deactivation logic. The API route `/api/search` and export routes go through
  `getCurrentUser()` and inherit the change automatically.
- Unit-test the pure claim-mapping if extracted (`claimsToUserShell(claims)`), and
  keep the existing session tests green.

### Rollout order (strict)

1. **PERF-1a `[builder]`** — the code change above + tests. Ship. (Safe on legacy
   keys — automatic fallback, zero behavior change.)
2. **PERF-1b `[USER]`** — Supabase dashboard → Project Settings → JWT Keys →
   **migrate to asymmetric signing keys** (follow the dashboard's guided flow;
   existing sessions keep working — Supabase dual-validates during rotation). This is
   what flips the perf win on. Add to the standing runbook checklist.
3. **PERF-1c `[verify]`** — after 1b: confirm login/logout/invite/set-password/demo
   flows all still work live; check Vercel logs show page-level Auth API calls gone;
   record before/after navigation timing (the middleware ~66ms hop remains, the page's
   duplicate hop disappears).

### Explicitly rejected alternatives (do not revisit without a new design pass)

- **Dropping the middleware `getUser()`** — breaks token refresh (pages can't
  reliably write cookies) and removes the revocation gate. Rejected.
- **Forwarding identity via request headers from middleware** — header-trust is
  exactly the brittleness the middleware CVE class exploits; cryptographic
  verification is strictly stronger. Rejected.
- **Caching the user in a server-side store keyed by cookie** — adds state, adds a
  poisoning surface, saves nothing over local JWT verification. Rejected.
