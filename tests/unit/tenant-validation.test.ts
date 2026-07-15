import { describe, it, expect } from 'vitest'
import { tenantFormSchema } from '@/lib/validation/tenant'

describe('tenantFormSchema', () => {
  it('accepts a valid tenant', () => {
    const result = tenantFormSchema.safeParse({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+43 1 234 5678',
      language: 'de',
      notes: 'Prefers email contact',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing fullName', () => {
    const result = tenantFormSchema.safeParse({
      email: 'jane@example.com',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty fullName', () => {
    const result = tenantFormSchema.safeParse({
      fullName: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = tenantFormSchema.safeParse({
      fullName: 'Jane Doe',
      email: 'not-an-email',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null for all optional fields', () => {
    // The action maps empty form inputs ("") to null before parsing (the template's
    // '' -> null idiom), so the schema only ever sees null for a blank optional, never
    // ''. This proves null (including a null email) is accepted.
    const result = tenantFormSchema.safeParse({
      fullName: 'Jane Doe',
      email: null,
      phone: null,
      language: null,
      notes: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBeNull()
      expect(result.data.language).toBeNull()
      expect(result.data.notes).toBeNull()
    }
  })

  it('accepts a fullName-only tenant (every other field omitted)', () => {
    const result = tenantFormSchema.safeParse({ fullName: 'Jane Doe' })
    expect(result.success).toBe(true)
  })
})
