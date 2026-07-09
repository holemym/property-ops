import { describe, it, expect, afterEach } from 'vitest'
import { isInviteOnly } from '@/lib/auth/signup-mode'

describe('isInviteOnly', () => {
  const original = process.env.SIGNUP_MODE

  afterEach(() => {
    process.env.SIGNUP_MODE = original
  })

  it('is false when unset (default: open signup)', () => {
    delete process.env.SIGNUP_MODE
    expect(isInviteOnly()).toBe(false)
  })

  it('is false for any value other than "invite"', () => {
    process.env.SIGNUP_MODE = 'open'
    expect(isInviteOnly()).toBe(false)
  })

  it('is true when set to "invite"', () => {
    process.env.SIGNUP_MODE = 'invite'
    expect(isInviteOnly()).toBe(true)
  })
})
