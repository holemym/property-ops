import { describe, it, expect } from 'vitest'
import { tenancyFormSchema } from '@/lib/validation/tenancy'

describe('tenancyFormSchema', () => {
  const valid = {
    unitId: '11111111-1111-4111-8111-111111111111',
    tenantName: 'Alice Berger',
    startDate: '2026-01-01',
  }

  it('accepts a valid free-text payload with no linked person', () => {
    const result = tenancyFormSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  // P1-3: the optional directory-person picker. Same nullable-uuid shape as
  // ticketCreateSchema's unitId (see ticket-validation.test.ts).
  it('accepts a valid tenantId uuid', () => {
    const result = tenancyFormSchema.safeParse({
      ...valid,
      tenantId: '22222222-2222-4222-8222-222222222222',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a null or omitted tenantId (unlinked tenancy)', () => {
    expect(tenancyFormSchema.safeParse({ ...valid, tenantId: null }).success).toBe(true)
    expect(tenancyFormSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-uuid tenantId', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, tenantId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid unitId', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, unitId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty tenant name', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, tenantName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed start date', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, startDate: '01/01/2026' })
    expect(result.success).toBe(false)
  })

  it('accepts a null end date (open-ended)', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, endDate: null })
    expect(result.success).toBe(true)
  })

  // Cross-field refine: an inverted span never parses; end == start (a single-day
  // tenancy) is the boundary case and stays valid.
  it('rejects an end date before the start date', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, endDate: '2025-12-31' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('End date must be on or after the start date.')
    }
  })

  it('accepts an end date equal to the start date (single-day tenancy)', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, endDate: '2026-01-01' })
    expect(result.success).toBe(true)
  })

  it('accepts an end date after the start date', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, endDate: '2026-06-30' })
    expect(result.success).toBe(true)
  })

  it('rejects a non-positive rent amount', () => {
    const result = tenancyFormSchema.safeParse({ ...valid, rentAmount: 0 })
    expect(result.success).toBe(false)
  })
})
