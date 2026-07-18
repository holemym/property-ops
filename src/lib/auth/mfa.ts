// Client-side format guard for a TOTP verification code before it's sent to Supabase —
// exactly 6 digits, no separators/whitespace. Keeps the Verify button disabled until the
// input looks plausible and gives an immediate rejection reason without a network
// round-trip; Supabase's own mfa.verify() call remains the actual security check (this
// is a UX guard, not a security boundary).
export function isValidTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code)
}
