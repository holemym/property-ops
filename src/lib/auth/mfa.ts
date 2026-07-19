// Client-side format guard for a TOTP verification code before it's sent to Supabase —
// exactly 6 digits, no separators/whitespace. Keeps the Verify button disabled until the
// input looks plausible and gives an immediate rejection reason without a network
// round-trip; Supabase's own mfa.verify() call remains the actual security check (this
// is a UX guard, not a security boundary).
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}

// The security-critical AAL decision (S2-1 spec §3), extracted so it's unit-testable
// without mocking `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`. Exact predicate
// from the spec: `nextLevel === 'aal2' && currentLevel === 'aal1'`.
//
// THE INVARIANT: a user with NO verified MFA factor must NEVER be sent to /auth/mfa.
// Supabase's own `getAuthenticatorAssuranceLevel()` guarantees this holds — when a
// session has no verified factor, it sets `nextLevel = currentLevel` (both 'aal1' for a
// plain password session, or both `null` for no session at all; see
// `_getAuthenticatorAssuranceLevel` in @supabase/auth-js's GoTrueClient.js, which only
// ever bumps `nextLevel` to 'aal2' when `verifiedFactors.length > 0`). So `nextLevel`
// can only equal 'aal2' when a verified factor exists, and this function only returns
// true in that case AND when the current session hasn't cleared the challenge yet.
// Two call sites: signInWithPassword() in (auth)/actions.ts (post-login redirect) and
// requireUser() in session.ts (the enforcement gate on every authenticated page).
export function needsMfaChallenge(currentLevel: string | null, nextLevel: string | null): boolean {
  return nextLevel === 'aal2' && currentLevel === 'aal1'
}

// Server-side anti-forgery guard for the MFA-challenge audit write (S2-2,
// logMfaChallengeOutcome). That action is a client-triggered write into the
// service-role-only `auth_events` log, so the client-supplied `success` flag can NOT be
// trusted — it's corroborated here against the session's OWN assurance level (a local
// JWT read the caller can't fake):
//   - a SUCCESS is real only if the session actually reached aal2 — and ONLY a genuine
//     mfa.verify() elevates a session to aal2, so a password-only aal1 caller can never
//     forge an MFA_CHALLENGE_SUCCESS row;
//   - a FAILURE is logged only for a session genuinely mid-challenge (aal1 with a
//     verified factor pending, i.e. needsMfaChallenge) — a no-factor or already-elevated
//     caller has nothing to fail and can't inject failure noise.
// The caller still enforces "a live session exists" separately (ctx.userId != null)
// before this runs, closing the unauthenticated-flood vector.
export function mfaOutcomeIsCorroborated(
  success: boolean,
  currentLevel: string | null,
  nextLevel: string | null,
): boolean {
  return success ? currentLevel === 'aal2' : needsMfaChallenge(currentLevel, nextLevel)
}
