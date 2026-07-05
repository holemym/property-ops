import { describe, it, expect } from 'vitest'
import { vendorFormSchema } from '@/lib/validation/vendor'

describe('vendorFormSchema', () => {
  it('accepts a valid vendor', () => {
    const result = vendorFormSchema.safeParse({
      companyName: 'Alpha Plumbing',
      contactName: 'Sam Smith',
      email: 'sam@alpha.example',
      phone: '+43 1 234 5678',
      serviceCategory: 'PLUMBING',
      notes: 'reliable',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a missing companyName', () => {
    const result = vendorFormSchema.safeParse({
      serviceCategory: 'PLUMBING',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = vendorFormSchema.safeParse({
      companyName: 'Alpha Plumbing',
      email: 'not-an-email',
      serviceCategory: 'PLUMBING',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null for all optional fields', () => {
    // The action maps empty form inputs ("") to null before parsing (the template's
    // '' -> null idiom), so the schema only ever sees null for a blank optional, never
    // ''. This proves null (including a null email) is accepted.
    const result = vendorFormSchema.safeParse({
      companyName: 'Alpha Plumbing',
      serviceCategory: 'PLUMBING',
      contactName: null,
      email: null,
      phone: null,
      notes: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBeNull()
      expect(result.data.notes).toBeNull()
    }
  })
})
