import { describe, it, expect } from 'vitest'
import { claimsToUserShell } from '@/lib/auth/session'

// PERF-1a: getCurrentUser() swapped auth.getUser() for auth.getClaims(). The only new
// pure logic worth unit-testing is the claims -> {id, email} mapping (and its "no sub"
// guard) — everything else in getCurrentUser() is a direct Supabase/network call not
// worth mocking here. See docs/superpowers/specs/2026-07-12-property-ops-perf1-auth-roundtrip-design.md.
describe('claimsToUserShell', () => {
  it('maps sub to id and passes email through', () => {
    expect(claimsToUserShell({ sub: 'user-123', email: 'a@b.com' })).toEqual({
      id: 'user-123',
      email: 'a@b.com',
    })
  })

  it('falls back to an empty string when email is absent (same as the old user.email ?? \'\')', () => {
    expect(claimsToUserShell({ sub: 'user-123' })).toEqual({ id: 'user-123', email: '' })
  })

  it('returns null when claims is null (no session)', () => {
    expect(claimsToUserShell(null)).toBeNull()
  })

  it('returns null when claims is undefined (getClaims() returned no data)', () => {
    expect(claimsToUserShell(undefined)).toBeNull()
  })

  it('returns null when sub is an empty string', () => {
    expect(claimsToUserShell({ sub: '', email: 'a@b.com' })).toBeNull()
  })
})
