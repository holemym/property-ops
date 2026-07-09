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
