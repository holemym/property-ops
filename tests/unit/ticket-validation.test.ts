import { describe, it, expect } from 'vitest'
import {
  ticketCreateSchema,
  ticketCommentSchema,
  ticketStatusSchema,
  ticketScheduleSchema,
} from '@/lib/validation/ticket'

describe('ticketCreateSchema', () => {
  const valid = {
    propertyId: '11111111-1111-4111-8111-111111111111',
    title: 'Leaking tap in bathroom',
    description: 'The cold tap drips continuously.',
    category: 'PLUMBING',
    priority: 'NORMAL',
  }

  it('accepts a valid create payload', () => {
    const result = ticketCreateSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('accepts a nullable unitId', () => {
    const result = ticketCreateSchema.safeParse({
      ...valid,
      unitId: '22222222-2222-4222-8222-222222222222',
    })
    expect(result.success).toBe(true)
    const withNull = ticketCreateSchema.safeParse({ ...valid, unitId: null })
    expect(withNull.success).toBe(true)
  })

  it('rejects a short title (< 3 chars)', () => {
    const result = ticketCreateSchema.safeParse({ ...valid, title: 'ab' })
    expect(result.success).toBe(false)
  })

  it('rejects an empty description', () => {
    const result = ticketCreateSchema.safeParse({ ...valid, description: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a bad category', () => {
    const result = ticketCreateSchema.safeParse({ ...valid, category: 'NOT_A_CATEGORY' })
    expect(result.success).toBe(false)
  })

  it('rejects a bad priority', () => {
    const result = ticketCreateSchema.safeParse({ ...valid, priority: 'SUPER_URGENT' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-uuid propertyId', () => {
    const result = ticketCreateSchema.safeParse({ ...valid, propertyId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('ticketCommentSchema', () => {
  it('accepts a valid public comment', () => {
    const result = ticketCommentSchema.safeParse({ body: 'On my way tomorrow.', visibility: 'PUBLIC' })
    expect(result.success).toBe(true)
  })

  it('accepts an internal comment', () => {
    const result = ticketCommentSchema.safeParse({ body: 'Tenant is difficult.', visibility: 'INTERNAL' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty body', () => {
    const result = ticketCommentSchema.safeParse({ body: '', visibility: 'PUBLIC' })
    expect(result.success).toBe(false)
  })

  it('rejects a bad visibility', () => {
    const result = ticketCommentSchema.safeParse({ body: 'hi', visibility: 'SECRET' })
    expect(result.success).toBe(false)
  })
})

describe('ticketStatusSchema', () => {
  it('accepts a valid status', () => {
    const result = ticketStatusSchema.safeParse({ status: 'TRIAGE' })
    expect(result.success).toBe(true)
  })

  it('rejects a bad status', () => {
    const result = ticketStatusSchema.safeParse({ status: 'NOT_A_STATUS' })
    expect(result.success).toBe(false)
  })
})

describe('ticketScheduleSchema', () => {
  // datetime-local submits "YYYY-MM-DDTHH:mm"; build one a year out so the
  // future-date refine always passes regardless of when the suite runs.
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)

  it('accepts a future datetime-local value', () => {
    const result = ticketScheduleSchema.safeParse({ scheduledAt: future })
    expect(result.success).toBe(true)
  })

  it('rejects an empty value', () => {
    const result = ticketScheduleSchema.safeParse({ scheduledAt: '' })
    expect(result.success).toBe(false)
  })

  it('rejects an unparseable value', () => {
    const result = ticketScheduleSchema.safeParse({ scheduledAt: 'not-a-date' })
    expect(result.success).toBe(false)
  })

  it('rejects a past datetime with the friendly future-date message', () => {
    const result = ticketScheduleSchema.safeParse({ scheduledAt: '2020-01-01T10:00' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Scheduled time must be in the future.')
    }
  })
})
