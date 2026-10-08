import { describe, it, expect } from 'vitest'
import { safeNext, failureTarget, linkErrorMessage } from '@/lib/auth/callback'

describe('safeNext', () => {
  it('keeps same-origin paths, including their query', () => {
    expect(safeNext('/auth/set-password?reason=reset')).toBe('/auth/set-password?reason=reset')
    expect(safeNext('/portal/home')).toBe('/portal/home')
  })

  it('rejects anything that could leave the origin', () => {
    expect(safeNext('@evil.com')).toBe('/dashboard') // `${origin}@evil.com` = userinfo
    expect(safeNext('//evil.com')).toBe('/dashboard') // protocol-relative
    expect(safeNext('/\\evil.com')).toBe('/dashboard') // backslash-normalised by browsers
    expect(safeNext('https://evil.com')).toBe('/dashboard')
  })

  it('defaults when absent', () => {
    expect(safeNext(null)).toBe('/dashboard')
    expect(safeNext(undefined)).toBe('/dashboard')
    expect(safeNext('')).toBe('/dashboard')
  })
})

describe('failureTarget', () => {
  it('sends a broken reset link back to the reset form', () => {
    expect(failureTarget('/auth/set-password?reason=reset')).toBe('/forgot-password')
  })

  it('sends every other broken link to sign-in', () => {
    expect(failureTarget('/auth/set-password?reason=invite')).toBe('/login')
    expect(failureTarget('/dashboard')).toBe('/login')
  })
})

describe('linkErrorMessage', () => {
  it('explains the different-browser (PKCE) failure', () => {
    expect(linkErrorMessage(null, 'invalid request: both auth code and code verifier should be non-empty')).toBe(
      'Open the link in the same browser you requested it from, or request a new link here.'
    )
    expect(linkErrorMessage('flow_state_not_found', '')).toBe(
      'Open the link in the same browser you requested it from, or request a new link here.'
    )
    expect(linkErrorMessage('bad_code_verifier', '')).toBe(
      'Open the link in the same browser you requested it from, or request a new link here.'
    )
  })

  it('explains expired or reused links', () => {
    expect(linkErrorMessage('otp_expired', 'Email link is invalid or has expired')).toBe(
      'That link has expired or was already used. Request a new one.'
    )
    expect(linkErrorMessage('access_denied', null)).toBe(
      'That link has expired or was already used. Request a new one.'
    )
  })

  it('falls back without leaking the raw provider message', () => {
    expect(linkErrorMessage(null, 'some internal provider failure')).toBe('That link did not work. Request a new one.')
  })
})
