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
