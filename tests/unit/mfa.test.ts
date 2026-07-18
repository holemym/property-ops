import { describe, it, expect } from 'vitest'
import { isValidTotpCode, needsMfaChallenge } from '@/lib/auth/mfa'

describe('isValidTotpCode', () => {
  it('accepts exactly 6 digits', () => {
    expect(isValidTotpCode('123456')).toBe(true)
    expect(isValidTotpCode('000000')).toBe(true)
  })

  it('rejects fewer or more than 6 digits', () => {
    expect(isValidTotpCode('12345')).toBe(false)
    expect(isValidTotpCode('1234567')).toBe(false)
    expect(isValidTotpCode('')).toBe(false)
  })

  it('rejects non-digit characters', () => {
    expect(isValidTotpCode('12a456')).toBe(false)
    expect(isValidTotpCode('123 456')).toBe(false)
    expect(isValidTotpCode('123-456')).toBe(false)
  })
})

describe('needsMfaChallenge', () => {
  // THE INVARIANT: a user with no verified MFA factor must NEVER be redirected to
  // /auth/mfa. Supabase reports nextLevel === currentLevel for such sessions (both
  // 'aal1' for a plain password sign-in, or both null for no session at all) — these
  // cases are the ones that matter most and must stay false forever.
  it('is false for a user with no enrolled factor at all (nextLevel === currentLevel === aal1)', () => {
    expect(needsMfaChallenge('aal1', 'aal1')).toBe(false)
  })

  it('is false when there is no session at all (both levels null)', () => {
    expect(needsMfaChallenge(null, null)).toBe(false)
  })

  it('is true only for an AAL1 session with a verified factor pending challenge', () => {
    expect(needsMfaChallenge('aal1', 'aal2')).toBe(true)
  })

  it('is false once the session has already completed the challenge (both aal2)', () => {
    expect(needsMfaChallenge('aal2', 'aal2')).toBe(false)
  })

  it('is false for the nonsensical downgrade case (aal2 current, aal1 next)', () => {
    expect(needsMfaChallenge('aal2', 'aal1')).toBe(false)
  })

  it('is false when currentLevel is missing/null but nextLevel reports aal2', () => {
    // Defensive: the real client never produces this shape, but the predicate should
    // still fail closed (no redirect) rather than throw or misfire.
    expect(needsMfaChallenge(null, 'aal2')).toBe(false)
  })
})
