// Maps raw Supabase Auth errors to fixed, friendly strings (Track S1.4) before they
// round-trip through the `?error=` URL param. Raw error.message can leak implementation
// detail (exact validation wording, provider-specific phrasing) and is inconsistent
// across Supabase versions; a small fixed set reads better and doesn't change if
// Supabase's wording changes upstream. Unknown errors fall back to one generic string —
// never re-throw or expose the raw message.
//
// `code` (AuthError.code in supabase-js v2) is the primary signal when present; the
// message substring checks are a fallback for errors that don't carry a code (some
// OAuth/provider errors, older error shapes).
type AuthErrorLike = { message?: string | null; code?: string | null } | null | undefined

export function friendlyAuthError(error: AuthErrorLike): string {
  if (!error) return 'Something went wrong. Please try again.'

  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'Incorrect email or password.'
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in.'
  }
  if (
    code === 'user_already_exists' ||
    message.includes('already registered') ||
    message.includes('already exists')
  ) {
    return 'An account with this email already exists.'
  }
  if (code === 'weak_password' || message.includes('password should be')) {
    return 'Please choose a stronger password.'
  }
  // Email-send limit is checked BEFORE the generic rate-limit branch (its message,
  // "email rate limit exceeded", also matches the generic substring). It is a
  // PROJECT-WIDE budget on Supabase's mailer (2/hour on the built-in one), not the
  // caller's own attempts — "too many attempts" was blaming first-time users for it.
  if (code === 'over_email_send_rate_limit' || message.includes('email rate limit')) {
    return 'The email service is at its hourly sending limit — please try again in about an hour.'
  }
  if (code === 'over_request_rate_limit' || message.includes('rate limit')) {
    return 'Too many attempts. Try again in a few minutes.'
  }
  // signInWithOtp with shouldCreateUser: false (invite-only mode) rejects unknown
  // emails with "Signups not allowed for otp".
  if (code === 'otp_disabled' || message.includes('signups not allowed')) {
    return 'No account exists for this email. Ask your administrator for an invite.'
  }

  return 'Something went wrong. Please try again.'
}
