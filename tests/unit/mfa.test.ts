import { describe, it, expect } from 'vitest'
import { isValidTotpCode, needsMfaChallenge, mfaOutcomeIsCorroborated } from '@/lib/auth/mfa'

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

describe('mfaOutcomeIsCorroborated', () => {
  // The anti-forgery guard for the MFA-challenge audit write. A client-supplied
  // success/failure flag is only honored when the session's OWN assurance level backs it.
  describe('SUCCESS', () => {
    it('is true only when the session actually reached aal2 (a real verify())', () => {
      expect(mfaOutcomeIsCorroborated(true, 'aal2', 'aal2')).toBe(true)
    })

    // THE FORGERY CASE: a password-only AAL1 caller (verified factor pending, or none)
    // claims success. Must be rejected — only a genuine verify() elevates to aal2.
    it('is false for an aal1 caller claiming success while a factor is pending (forged)', () => {
      expect(mfaOutcomeIsCorroborated(true, 'aal1', 'aal2')).toBe(false)
    })

    it('is false for a no-factor aal1 caller claiming success (forged)', () => {
      expect(mfaOutcomeIsCorroborated(true, 'aal1', 'aal1')).toBe(false)
    })

    it('is false for a no-session caller claiming success', () => {
      expect(mfaOutcomeIsCorroborated(true, null, null)).toBe(false)
    })
  })

  describe('FAILURE', () => {
    it('is true only for a session genuinely mid-challenge (aal1 with factor pending)', () => {
      expect(mfaOutcomeIsCorroborated(false, 'aal1', 'aal2')).toBe(true)
    })

    it('is false once the session is already elevated (nothing left to fail)', () => {
      expect(mfaOutcomeIsCorroborated(false, 'aal2', 'aal2')).toBe(false)
    })

    it('is false for a no-factor caller claiming failure (no challenge to fail)', () => {
      expect(mfaOutcomeIsCorroborated(false, 'aal1', 'aal1')).toBe(false)
    })

    it('is false for a no-session caller claiming failure', () => {
      expect(mfaOutcomeIsCorroborated(false, null, null)).toBe(false)
    })
  })
})
