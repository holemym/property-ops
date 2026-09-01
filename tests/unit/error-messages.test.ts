import { describe, it, expect } from 'vitest'
import { friendlyAuthError } from '@/lib/auth/error-messages'

describe('friendlyAuthError', () => {
  it('maps invalid_credentials by code', () => {
    expect(friendlyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials' }))
      .toBe('Incorrect email or password.')
  })

  it('maps invalid credentials by message when code is absent', () => {
    expect(friendlyAuthError({ message: 'Invalid login credentials' })).toBe(
      'Incorrect email or password.'
    )
  })

  it('maps email_not_confirmed', () => {
    expect(friendlyAuthError({ code: 'email_not_confirmed' })).toBe(
      'Please confirm your email address before signing in.'
    )
  })

  it('maps user_already_exists', () => {
    expect(friendlyAuthError({ code: 'user_already_exists' })).toBe(
      'An account with this email already exists.'
    )
  })

  it('maps a weak-password message', () => {
    expect(friendlyAuthError({ message: 'Password should be at least 6 characters' })).toBe(
      'Please choose a stronger password.'
    )
  })

  it('maps rate limit errors', () => {
    expect(friendlyAuthError({ code: 'over_request_rate_limit' })).toBe(
      'Too many attempts. Try again in a few minutes.'
    )
  })

  // The email-send limit is a PROJECT-WIDE mailer budget (2/hour on Supabase's built-in
  // SMTP), not the caller's own attempts — it must NOT read as "too many attempts",
  // which blamed first-time testers for a shared quota. The message-substring case
  // ("email rate limit exceeded") also matches the generic 'rate limit' branch, so
  // these pin the ORDER of the checks too.
  it('maps the project-wide email send limit to its own message, by code and by message', () => {
    expect(friendlyAuthError({ code: 'over_email_send_rate_limit' })).toBe(
      'The email service is at its hourly sending limit — please try again in about an hour.'
    )
    expect(friendlyAuthError({ message: 'email rate limit exceeded' })).toBe(
      'The email service is at its hourly sending limit — please try again in about an hour.'
    )
  })

  // signInWithOtp with shouldCreateUser:false (invite-only mode) rejects unknown emails
  // with "Signups not allowed for otp" — surfaced as an invite hint, not a generic error.
  it('maps invite-mode magic links for unknown emails to an invite hint', () => {
    expect(friendlyAuthError({ message: 'Signups not allowed for otp' })).toBe(
      'No account exists for this email. Ask your administrator for an invite.'
    )
    expect(friendlyAuthError({ code: 'otp_disabled' })).toBe(
      'No account exists for this email. Ask your administrator for an invite.'
    )
  })

  it('falls back to a generic message for unknown errors', () => {
    expect(friendlyAuthError({ message: 'some unmapped provider error' })).toBe(
      'Something went wrong. Please try again.'
    )
  })

  it('falls back to a generic message for null/undefined', () => {
    expect(friendlyAuthError(null)).toBe('Something went wrong. Please try again.')
    expect(friendlyAuthError(undefined)).toBe('Something went wrong. Please try again.')
  })
})
