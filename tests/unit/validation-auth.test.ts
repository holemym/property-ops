import { describe, it, expect } from 'vitest'
import { passwordSchema, signupSchema } from '@/lib/validation/auth'

describe('passwordSchema', () => {
  it('rejects passwords under 10 characters', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false)
  })

  it('accepts a 10+ character password', () => {
    expect(passwordSchema.safeParse('longenoughpassword').success).toBe(true)
  })
})

describe('signupSchema', () => {
  const valid = { fullName: 'Ada Lovelace', email: 'ada@example.com', password: 'longenoughpassword' }

  it('accepts a fully valid payload', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a missing name', () => {
    expect(signupSchema.safeParse({ ...valid, fullName: '' }).success).toBe(false)
  })

  it('rejects an invalid email', () => {
    expect(signupSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects a short password', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false)
  })
})
