# Property Ops — Security Hardening (Track S) — Design

**Date:** 2026-07-09 · **Status:** approved · **Depends on:** nothing (build first)
**Context:** the app will hold sensitive tenant/finance data; hosted on Vercel+Supabase
today, self-hosted later. Full audit findings: roadmap v2 §3. This spec defines Stages
S1 (build now), S2 (build after P2), S3 (docs, write right after Track D).

Read roadmap v2 §2 (hard rules) first. Never log secrets or PII while implementing.

---

## Stage S1 — hosted quick wins

### S1.1 HTTP security headers + CSP

**File:** `next.config.ts` — add an async `headers()` returning one rule for `/(.*)`:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `Content-Security-Policy-Report-Only` *(step 1)* | see below |
| `Content-Security-Policy` *(step 2, separate commit after live verification)* | same value |

CSP value (single line in code; shown wrapped here):

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https://*.tile.openstreetmap.org;
font-src 'self';
connect-src 'self' https://mdnffpqwudsyldhembzo.supabase.co;
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

Notes: `'unsafe-inline'` for script/style is deliberate v1 (App Router streaming +
Tailwind inline styles; nonce upgrade is S2.3) — it still blocks all external script
injection. `connect-src` must include the Supabase URL (browser client talks to
PostgREST/auth/storage directly); read it from the env at config time rather than
hardcoding if straightforward. OSM tiles pre-allowed for Track M. **Rollout:** ship
Report-Only, user browses the live app while watching DevTools console for violations,
then flip to enforcing in a follow-up commit.

**Verify:** `curl -sI https://property-ops-sandy.vercel.app/login` shows the headers;
app works with zero CSP violations in console (dashboard, tickets, occupancy chart,
insights, documents, print views).

### S1.2 Invite-only signup + set-password page

**Env:** `SIGNUP_MODE` = `open` (default, current behavior) | `invite`. Read via a tiny
helper `src/lib/auth/signup-mode.ts` (`isInviteOnly()`).

- `signUpWithPassword` in `src/app/(auth)/actions.ts`: when invite-only, immediately
  `redirectWithError('/signup', 'Sign-ups are by invitation. Ask your administrator for an invite — or explore the demo.')`.
  Server-side rejection is the security boundary; UI is cosmetic.
- `/signup` page: when invite-only, replace the form with an invitation notice + (after
  Track D) the demo-entry button. Pass the mode from the server component.
- **Set-password gap:** invited users arrive via `inviteUserByEmail` magic link →
  `/auth/callback` → logged in with **no password**. Add `src/app/(auth)/auth/set-password/page.tsx`
  (+ server action in `(auth)/actions.ts`): a logged-in-only page with one password
  field (zod: min 10 chars) calling `supabase.auth.updateUser({ password })`, then
  redirect `/dashboard`. Link it from the callback flow: `/auth/callback` route already
  exchanges the code; append `?next=/auth/set-password` handling for invite links
  (inviteUserByEmail's `redirectTo` gains that param in `settings/users/actions.ts`).
  Keep the page reachable any time for password changes (it's the app's only one).
- Proxy: `/auth/set-password` is authenticated — do NOT add to `PUBLIC_PATHS`.

**Verify:** with `SIGNUP_MODE=invite` set locally: self-signup rejected; invite from
Settings → Users still works end-to-end (user action: click the emailed link) and lands
on set-password. With mode unset: behavior unchanged. Unit-test `isInviteOnly()` and
the password zod schema.

### S1.3 Rate limiting (Postgres-backed)

**Why Postgres:** zero new deps/services, identical behavior self-hosted, survives
serverless instance churn (in-memory would not).

**Migration 0022** (idempotent; fold into `schema_bundle.sql`; RLS review required):

```sql
create table if not exists public.rate_limit_buckets (
  key text primary key,          -- e.g. 'login:1.2.3.4' or 'search:<user_id>'
  window_start timestamptz not null,
  count integer not null default 0
);
alter table public.rate_limit_buckets enable row level security;
-- zero policies: only the SECURITY DEFINER function touches it.

create or replace function public.check_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) returns boolean ...
```

Function semantics (fixed window): if the row's `window_start` is older than the
window, reset it to `now()` with `count = 1` and return `true`; else increment; return
`count <= p_max`. One `insert ... on conflict (key) do update` statement. `security
definer`, `revoke execute from public/anon/authenticated`, grant only `service_role`.
Include a best-effort purge of rows older than 1 day (a delete inside the function,
cheap at this scale — no cron).

**App side:** `src/lib/rate-limit.ts` — `checkRateLimit(key, max, windowSeconds):
Promise<boolean>` using the **service client**, wrapped in try/catch that returns
`true` on any error (**fail-open**: a limiter outage must not lock the org out) but
`console.error`s. Client IP helper: first hop of `x-forwarded-for` (Vercel-set), else
`'unknown'`.

**Apply to (limits are per-window counts):**

| Surface | Key | Limit |
|---|---|---|
| `signInWithPassword` | `login:<ip>` | 10 / 5 min |
| `signUpWithPassword` | `signup:<ip>` | 5 / 1 h |
| `GET /api/search` | `search:<user_id>` | 60 / 1 min |
| `/job/[token]` page + its actions | `job:<ip>` | 30 / 5 min |
| Demo entry (Track D, when built) | `demo:<ip>` | 5 / 10 min |

On limit: auth actions → `redirectWithError(..., 'Too many attempts. Try again in a few minutes.')`;
search route → `Response.json({ results: [] }, { status: 429 })`; job page → the
existing generic invalid-link screen.

**Verify:** unit-test the key-derivation helper; RLS suite asserts `check_rate_limit`
is not executable as `authenticated`/`anon`; manual: 11 rapid bad logins → friendly
throttle message. **USER action:** run migration 0022.

### S1.4 Error-message normalization

`redirectWithError` call sites in auth actions currently pass raw `error.message`.
Add `src/lib/auth/error-messages.ts`: `friendlyAuthError(error): string` mapping known
Supabase auth codes/messages (invalid credentials, email not confirmed, user already
registered, weak password, rate limit) to fixed strings, with a generic
`'Something went wrong. Please try again.'` fallback. Use it in every `(auth)/actions.ts`
redirect. Non-auth actions already redirect with their own literal strings — leave them.
Unit-test the mapping (known input → friendly, unknown → generic).

### S1.5 Upload constraints

Shared `src/lib/validation/upload.ts`:
`validateUpload(file: File): { ok: true } | { ok: false; error: string }` —
max size **20MB**; allowlist by extension AND declared MIME:
`pdf png jpg jpeg webp heic docx xlsx txt csv`. Reject empty files.
Apply in `tickets/attachment-actions.ts`, the documents upload action, and the vendor
job proof-upload action — before any storage call, error surfaced via the existing
`?error=` pattern. Unit-test the validator (size edge, bad extension, MIME/extension
mismatch, empty).

### S1.6 Password policy + Supabase dashboard runbook

- App-side: zod `min(10)` on signup + set-password (S1.2).
- **Runbook** `docs/runbooks/supabase-security-settings.md` (USER executes, exact
  dashboard paths): Auth → passwords: min length 10 + **leaked-password protection ON** ·
  session/JWT lifetimes reviewed (JWT expiry 1h; refresh-token rotation + reuse-interval
  defaults confirmed) · email OTP expiry ≤ 1h · Site URL + redirect allowlist verified ·
  confirm-email ON · note where PITR/backup settings live (free tier = daily backups;
  upgrade note for PITR).

---

## Stage S2 — deeper hardening (schedule after P2)

- **S2.1 MFA (TOTP):** enrollment UI under a new `/settings/security` page
  (`supabase.auth.mfa.enroll/challenge/verify`), backup guidance; enforcement =
  soft-require for OWNER/SUPER_ADMIN (banner-nag first release, hard-require later).
- **S2.2 Auth audit trail:** migration `auth_events` (workspace-scoped where known:
  event type login_success/login_failure/deactivation/invite/password_change, ip,
  user agent, created_at; INSERT via service role from the auth actions; SELECT
  manager-only). Surface: simple table on `/settings/security`. RLS review required.
- **S2.3 CSP nonce upgrade:** replace `'unsafe-inline'` script-src with per-request
  nonces via proxy-generated header (document Next 16 nonce pattern; verify streaming).
- **S2.4 Dependency audit routine:** `npm run audit` script + monthly runbook entry;
  update policy (patch/minor free; major = deliberate).

## Stage S3 — self-host portability (docs-only)

`docs/runbooks/self-hosting.md`, written right after Track D:
1. **Portability rules** (enforced now): no Vercel-only APIs; integrations raw-fetch;
   all config via env vars (matrix table: every env var, required?, stage).
2. **Target architecture:** one VPS/on-prem box — Docker-compose Supabase (their
   official compose) + Next standalone build (`output: 'standalone'` note) + Caddy
   (auto-TLS) in front; SMTP config for auth emails.
3. **Migration path:** `pg_dump` from cloud → restore; storage object sync script;
   env cutover; DNS; smoke-test checklist (login, RLS spot-checks via the test suite,
   signed URLs, invite email).
4. **Operations:** nightly `pg_dump` cron + storage rsync, restore drill, update
   cadence for the Supabase images, uptime monitoring pointer.

---

## Testing & acceptance (S1)

- All existing 261 tests green; new unit tests: rate-limit key helper, upload
  validator, `friendlyAuthError`, `isInviteOnly`, password schema.
- RLS suite additions: `rate_limit_buckets` inaccessible to non-service roles.
- Manual on live after deploy: headers present (curl), zero CSP violations across the
  main surfaces, throttle message on hammered login, invite → set-password flow.
- Rollback notes: every piece is env-gated or additive (headers revert by config edit;
  `SIGNUP_MODE` unset = old behavior; limiter fail-open).

## Out of scope

WAF/DDoS (platform concern), SSO/SAML, field-level encryption, GDPR tooling
(export/delete requests — backlog candidate), realtime intrusion detection.
