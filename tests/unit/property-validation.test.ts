import { describe, it, expect } from 'vitest'
import { propertyFormSchema } from '@/lib/validation/property'

describe('propertyFormSchema', () => {
  it('accepts a valid property', () => {
    const result = propertyFormSchema.safeParse({
      name: 'Sunset Apartments', addressLine1: '1 Main St', city: 'Vienna',
      postalCode: '1010', country: 'AT', propertyType: 'APARTMENT_BUILDING',
    })
    expect(result.success).toBe(true)
  })
  it('rejects a name shorter than 2 characters', () => {
    const result = propertyFormSchema.safeParse({
      name: 'A', addressLine1: '1 Main St', city: 'Vienna',
      postalCode: '1010', country: 'AT', propertyType: 'APARTMENT_BUILDING',
    })
    expect(result.success).toBe(false)
  })
  it('rejects an invalid propertyType', () => {
    const result = propertyFormSchema.safeParse({
      name: 'Sunset Apartments', addressLine1: '1 Main St', city: 'Vienna',
      postalCode: '1010', country: 'AT', propertyType: 'NOT_A_TYPE',
    })
    expect(result.success).toBe(false)
  })
})
