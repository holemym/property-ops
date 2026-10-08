// Pure helpers for /auth/callback — every email link (signup confirmation, magic link,
// invite, password reset) lands there, so a mistake here strands people on /login with
// no idea why. Kept pure so the decisions are unit-tested.

// `next` is attacker-controllable (it rides in the email link's query). It must be a
// same-origin PATH: the callback builds `${origin}${next}`, so `@evil.com` would turn the
// origin into userinfo and leave the site, and `//evil.com` / `/\evil.com` are
// protocol-relative in browsers. Anything else falls back to the dashboard.
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/dashboard'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard'
  return raw
}

// Where a failed link should land. A broken RESET link goes back to the reset form, so
// the person can request a new one in the same place; everything else goes to sign-in,
// which carries both the password form and the magic-link form.
export function failureTarget(next: string): '/forgot-password' | '/login' {
  return next.startsWith('/auth/set-password') && next.includes('reason=reset')
    ? '/forgot-password'
    : '/login'
}

// Supabase's link failures, in the words a resident or a property manager needs. The
// PKCE case matters most: these links only work in the browser that requested them
// (the code verifier lives in that browser's cookie), and opening the email on a phone
// after requesting on a laptop is the most common way people end up back at sign-in.
export function linkErrorMessage(code: string | null | undefined, message: string | null | undefined): string {
  const c = (code ?? '').toLowerCase()
  const m = (message ?? '').toLowerCase()

  if (
    c === 'bad_code_verifier' ||
    c.startsWith('flow_state') ||
    m.includes('code verifier') ||
    m.includes('code_verifier') ||
    m.includes('flow state')
  ) {
    return 'Open the link in the same browser you requested it from, or request a new link here.'
  }
  if (c === 'otp_expired' || m.includes('expired') || m.includes('invalid') || c === 'access_denied') {
    return 'That link has expired or was already used. Request a new one.'
  }
  return 'That link did not work. Request a new one.'
}
