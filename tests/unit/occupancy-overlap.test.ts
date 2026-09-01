import { describe, it, expect } from 'vitest'
import type { Tenancy } from '@/types/domain'
import { findOverlappingTenancy } from '@/lib/occupancy/overlap'

// Same minimal factory shape as occupancy-timeline.test.ts — only the fields the
// helper reads matter (id, start_date, end_date); the rest satisfy the Tenancy type.
function tenancy(partial: Partial<Tenancy> & { id: string; start_date: string }): Tenancy {
  return {
    workspace_id: 'ws-1',
    unit_id: 'unit-1',
    tenant_id: null,
    tenant_name: `Tenant ${partial.id}`,
    tenant_contact: null,
    end_date: null,
    rent_amount: null,
    notes: null,
    created_by_user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('findOverlappingTenancy', () => {
  const closed = tenancy({ id: 't1', start_date: '2026-01-01', end_date: '2026-03-31' })
  const open = tenancy({ id: 't2', start_date: '2026-06-01', end_date: null })

  it('returns null for an empty list', () => {
    expect(findOverlappingTenancy([], '2026-01-01', null)).toBeNull()
  })

  it('returns null when the candidate sits cleanly between existing spans', () => {
    expect(findOverlappingTenancy([closed, open], '2026-04-01', '2026-05-31')).toBeNull()
  })

  it('detects a candidate strictly inside an existing span', () => {
    expect(findOverlappingTenancy([closed], '2026-02-01', '2026-02-15')?.id).toBe('t1')
  })

  it('detects an existing span strictly inside the candidate', () => {
    expect(findOverlappingTenancy([closed], '2025-12-01', '2026-05-01')?.id).toBe('t1')
  })

  // Closed intervals: the end date is the LAST covered day, so sharing a single
  // boundary day is a conflict — a clean handover starts the day after.
  it('treats a candidate starting on an existing end date as a conflict', () => {
    expect(findOverlappingTenancy([closed], '2026-03-31', null)?.id).toBe('t1')
  })

  it('treats a candidate ending on an existing start date as a conflict', () => {
    expect(findOverlappingTenancy([closed], '2025-11-01', '2026-01-01')?.id).toBe('t1')
  })

  it('accepts a candidate starting the day after an existing end date', () => {
    expect(findOverlappingTenancy([closed], '2026-04-01', '2026-04-30')).toBeNull()
  })

  it('open-ended existing span conflicts with any later candidate', () => {
    expect(findOverlappingTenancy([open], '2027-01-01', '2027-06-30')?.id).toBe('t2')
  })

  it('open-ended candidate conflicts with a span that has not ended before it starts', () => {
    expect(findOverlappingTenancy([open], '2026-01-01', null)?.id).toBe('t2')
  })

  it('open-ended candidate clears a span that ended before it starts', () => {
    expect(findOverlappingTenancy([closed], '2026-04-01', null)).toBeNull()
  })

  it('two open-ended spans always conflict', () => {
    const other = tenancy({ id: 't3', start_date: '2020-01-01', end_date: null })
    expect(findOverlappingTenancy([other], '2030-01-01', null)?.id).toBe('t3')
  })

  // The edit path passes the edited row's own id so it never conflicts with itself.
  it('excludeId skips the edited row but still reports other conflicts', () => {
    expect(findOverlappingTenancy([closed], '2026-01-01', '2026-03-31', 't1')).toBeNull()
    expect(findOverlappingTenancy([closed, open], '2026-01-01', null, 't1')?.id).toBe('t2')
  })

  it('returns the first (earliest-starting, given sorted input) conflicting span', () => {
    const late = tenancy({ id: 't9', start_date: '2026-02-01', end_date: '2026-02-28' })
    expect(findOverlappingTenancy([closed, late], '2026-01-15', '2026-02-15')?.id).toBe('t1')
  })
})
