# S2-1 — TOTP MFA enrollment + soft enforcement — Design

**Date:** 2026-07-12 · **Status:** approved (Fable design pass) · Replaces the
`[plan]` placeholder; board tasks S2-1a..S2-1c. Sequenced after P2 per roadmap, but
spec'd now so Sonnet can execute without another design session.

Supabase Auth ships TOTP MFA natively (`supabase.auth.mfa.*`, free tier included) —
we build only the UI and the assurance-level gate. **No migration, no RLS change.**

## 1. Concepts (for the builder — read once, then it's mechanical)

- A user **enrolls** a TOTP factor (`mfa.enroll({factorType:'totp'})` → returns QR
  code as data-URI + secret), then proves it once (`mfa.challenge` + `mfa.verify`) —
  the factor becomes `verified`, and the CURRENT session is immediately elevated.
- From then on, password sign-in yields an **AAL1** session; Supabase reports
  `mfa.getAuthenticatorAssuranceLevel()` → `{currentLevel:'aal1',
  nextLevel:'aal2'}`, meaning a TOTP challenge is required to finish.
- After challenge+verify, the session is **AAL2** — full access.

## 2. Settings surface — `/settings/security` (new page, `(app)` group)

Reachable by every authenticated non-tenant role (gate: `!isTenantRole(user.role)`;
tenants get MFA later if ever — portal stays simple). Nav: a "Settings" group entry
next to Users? No — Users lives at `/settings/users` with no group header today; add
a small "Settings" nav group holding both "Users" (moved label unchanged) and
"Security". Sections:

1. **Two-factor authentication** card.
   - No verified factor → explainer line + "Set up authenticator app" button →
     inline enroll flow (client component `MfaEnroll.tsx`): shows QR (`<img
     src={data.totp.qr_code}>`) + manual secret in a `<code>` block, 6-digit input
     (`inputMode="numeric"`, autoComplete="one-time-code"), Verify button →
     `challenge`+`verify` → success state + `router.refresh()`.
   - Verified factor(s) → list (friendly name "Authenticator app", enrolled date via
     `formatDate`) + "Remove" behind the house `ConfirmSubmit` (danger copy: removing
     2FA weakens the account) → `mfa.unenroll({factorId})`.
   - All `mfa.*` calls are CLIENT-side (`createBrowserClient` — check
     `src/lib/supabase/` for the existing browser-client helper; if none exists, add
     `client.ts` mirroring the official @supabase/ssr browser pattern — it may
     genuinely not exist yet since all auth so far is server-actions).
2. **Password** card — link to the existing `/auth/set-password` ("Change password").

## 3. The sign-in gate (the security-critical piece)

- New page `src/app/(auth)/auth/mfa/page.tsx` + client `MfaChallenge.tsx`: 6-digit
  input → `mfa.challenge({factorId})` + `mfa.verify` → hard navigate `/dashboard`
  (`window.location.assign`, not router.push — cookies changed).
- **Routing the gate:** after password sign-in succeeds, `signInWithPassword` action
  additionally calls `mfa.getAuthenticatorAssuranceLevel()`; when
  `nextLevel === 'aal2' && currentLevel === 'aal1'` → `redirect('/auth/mfa')`
  instead of `/dashboard`.
- **Enforcement beyond the redirect (must-have, or the gate is cosmetic):**
  `requireUser()` in `src/lib/auth/session.ts` gains the AAL check — when the
  session's `nextLevel` is `aal2` but `currentLevel` is `aal1`, redirect to
  `/auth/mfa` (allowlist: the mfa page itself + signOut must stay reachable).
  Implementation note: derive AAL from `getClaims()` claims (`aal` claim) once
  PERF-1a lands — zero extra network; until then
  `mfa.getAuthenticatorAssuranceLevel()` (local, reads the session — also free).
  `/auth/mfa` is an AUTHENTICATED page — do NOT add to proxy PUBLIC_PATHS.
- Magic-link + Google sign-ins land through `/auth/callback` → they hit
  `requireUser()` on first page load → same gate catches them. No callback changes.

## 4. Soft enforcement for owners

`DashboardMfaNag.tsx` — a dismissible (per-render, no persistence) `FormError`-toned
info banner on `/dashboard` only, when `role in ('OWNER','SUPER_ADMIN')` AND no
verified factor (server-side check: `mfa.listFactors()` via the user's server
client): "Protect this workspace — enable two-factor authentication. → Set up".
Hard enforcement (blocking managers without MFA) is explicitly OUT of scope v1;
revisit once the org has enrolled.

## 5. Out of scope

Recovery codes UI (Supabase TOTP has no native recovery codes — document in the
security card: "losing the device requires an admin to remove the factor via
dashboard"; note this in `docs/runbooks/supabase-security-settings.md`), SMS/WebAuthn
factors, per-role hard requirement, RLS `aal2` policy predicates (a real option for
S2-deep later — noted, not built).

## 6. Board decomposition

- **S2-1a** `[builder]` — browser-client helper (if missing) + `/settings/security`
  page + `MfaEnroll` + factor list/remove + Settings nav group + password-change
  link. Unit tests: any extracted pure helpers only (this task is mostly UI).
- **S2-1b** `[builder]` — `/auth/mfa` challenge page + `signInWithPassword` AAL
  redirect + the `requireUser()` AAL gate (+ its allowlist) + owner dashboard nag.
  Depends S2-1a. **This touches the auth boundary — flag any deviation instead of
  improvising.**
- **S2-1c** `[verify]` — enroll → QR verifies → sign out/in demands code → wrong code
  rejected → right code lands dashboard → remove factor restores plain sign-in;
  deep-link to /tickets while AAL1-pending redirects to /auth/mfa; nag shows for
  owner-without-factor only. (Needs a disposable test account — coordinate with USER;
  never enroll MFA on the user's real owner account during verification.)

**USER queue addition:** confirm TOTP is enabled: Supabase dashboard → Auth →
Multi-Factor (default ON for TOTP; just verify). Add the lost-device note to the
security runbook when S2-1a lands.
