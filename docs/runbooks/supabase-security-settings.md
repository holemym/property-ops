# Supabase security settings — one-time checklist (Track S1.6)

These are dashboard toggles the assistant cannot change (account/security settings
require a human click). Project: `property-ops` (ref `mdnffpqwudsyldhembzo`), org
`shinpin`. Do these once; revisit only if you rotate providers or see the item change.

Dashboard: `supabase.com/dashboard/project/mdnffpqwudsyldhembzo`

## 1. Password strength + leaked-password protection
**Authentication → Policies** (or **Authentication → Providers → Email**, Supabase has
moved this between a couple of spots across versions — search "password" in the
dashboard's Ctrl/Cmd-K if it's not where you expect):
- Minimum password length: set to **10** (matches the app's own `passwordSchema` —
  belt-and-suspenders; the app already rejects shorter passwords before Supabase sees
  them, but this closes any path that bypasses the app, e.g. a future direct API call).
- **Leaked password protection**: turn **ON**. Supabase checks new passwords against
  the HaveIBeenPwned breach corpus and rejects known-compromised ones.

## 2. Session / JWT lifetimes
**Authentication → Sessions** (or **Authentication → Settings**):
- JWT expiry: the default (**3600s / 1 hour**) is fine — confirm it hasn't been
  changed to something long (e.g. multi-day).
- Refresh token rotation: confirm **ON** (default). This invalidates a stolen refresh
  token once the legitimate client uses it again.
- Refresh token reuse interval: leave at the default (10s) — this is a grace window
  for network retries, not a security hole.

## 3. Email OTP / confirmation link expiry
**Authentication → Providers → Email**:
- OTP / magic-link expiry: confirm it's **≤ 1 hour** (default is usually 1h or less).
  A long-lived confirmation link sitting in an inbox is a bigger window of exposure.
- **Confirm email**: should be **ON** (it already is, per the existing signup flow —
  just confirm it hasn't been toggled off).

## 4. Site URL + redirect allowlist
**Authentication → URL Configuration**:
- Site URL should be the canonical production domain
  (`https://property-ops-sandy.vercel.app`).
- Redirect URLs allowlist should include `https://property-ops-sandy.vercel.app/**`
  (the wildcard covers `/auth/callback` and the new `/auth/set-password` flow's
  `?next=` param — no separate entry needed for the query string).
- This was flagged once before as having a `dvisionh` vs `sandy` domain mismatch —
  worth a quick glance to confirm it's still pointed at `sandy` if that's the one
  you're using day to day.

## 5. Backups
**Settings → Add-ons** (or **Database → Backups**):
- Free tier gives daily backups automatically — nothing to configure, just know it's
  there. If/when this project needs point-in-time recovery (PITR), that's a paid
  add-on — revisit if the data becomes business-critical enough to need sub-day RPO.

## 6. Anonymous sign-in (only needed once Track D — demo mode — is built)
**Authentication → Providers → Anonymous**: leave **OFF** until Track D is underway.
Turning it on early would let anyone reach `/dashboard` with an anonymous session
before the demo-mode workspace scoping exists to contain them.

## 7. TOTP MFA — enabled by default, and the lost-device recovery path (Track S2-1)
**Authentication → Multi-Factor**: TOTP is on by default on Supabase — just confirm it
hasn't been disabled.

The app (`/settings/security`) lets a signed-in user enroll, list, and remove their
**own** TOTP factor — that's self-service and needs no dashboard work. There is
deliberately no in-app "recovery codes" or admin-override UI (out of scope for v1, see
the S2-1 design doc §5), so the one case that *does* need you:

- A user loses their authenticator device and can no longer produce a 6-digit code.
  Once S2-1b (sign-in enforcement) ships, this locks them out of their account
  entirely — they can't reach `/settings/security` to remove the factor themselves,
  because they can't get past the MFA challenge to sign in at all.
- Fix: **Authentication → Users** → find the user → their MFA factors → delete the
  stale TOTP factor. This drops them back to password-only sign-in; tell them to
  re-enroll a new device from `/settings/security` once they're back in.

---

Nothing above changes app behavior — the app already enforces its own 10-character
password minimum and correct redirect URLs client-side. These are the belt-and-
suspenders settings on the Supabase side.
