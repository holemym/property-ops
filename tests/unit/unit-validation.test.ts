import { describe, it, expect } from 'vitest'
import { unitFormSchema } from '@/lib/validation/unit'

describe('unitFormSchema', () => {
  it('accepts a valid unit', () => {
    const result = unitFormSchema.safeParse({
      label: 'Top floor apartment',
      occupancyType: 'LONG_TERM',
      status: 'VACANT',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a valid status', () => {
    const result = unitFormSchema.safeParse({
      label: 'Unit 1',
      occupancyType: 'LONG_TERM',
      status: 'MAINTENANCE',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid status', () => {
    const result = unitFormSchema.safeParse({
      label: 'Unit 1',
      occupancyType: 'LONG_TERM',
      status: 'NOT_A_STATUS',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a missing label', () => {
    const result = unitFormSchema.safeParse({
      occupancyType: 'LONG_TERM',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty label', () => {
    const result = unitFormSchema.safeParse({
      label: '',
      occupancyType: 'LONG_TERM',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid occupancyType', () => {
    const result = unitFormSchema.safeParse({
      label: 'Unit 1',
      occupancyType: 'NOT_A_TYPE',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null for all optional fields', () => {
    const result = unitFormSchema.safeParse({
      label: 'Unit 1',
      occupancyType: 'LONG_TERM',
      status: 'VACANT',
      floor: null,
      staircase: null,
      sizeM2: null,
      roomCount: null,
      accessNotes: null,
      wifiInfo: null,
      heatingInfo: null,
      generalNotes: null,
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.floor).toBeNull()
      expect(result.data.sizeM2).toBeNull()
    }
  })

  it('coerces numeric strings and rejects non-positive sizes', () => {
    const ok = unitFormSchema.safeParse({ label: 'U', occupancyType: 'LONG_TERM', status: 'VACANT', sizeM2: '55.5', roomCount: '3' })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.sizeM2).toBe(55.5)
      expect(ok.data.roomCount).toBe(3)
    }
    const bad = unitFormSchema.safeParse({ label: 'U', occupancyType: 'LONG_TERM', status: 'VACANT', sizeM2: -5 })
    expect(bad.success).toBe(false)
  })
})
