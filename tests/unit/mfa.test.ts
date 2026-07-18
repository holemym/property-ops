import { describe, it, expect } from 'vitest'
import { isValidTotpCode } from '@/lib/auth/mfa'

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
