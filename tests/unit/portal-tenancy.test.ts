import { describe, it, expect } from 'vitest'
import { pickCurrentTenancy } from '@/lib/portal-tenancy'
import type { Tenancy } from '@/types/domain'

const TODAY = '2026-07-24'

function tenancy(overrides: Partial<Tenancy>): Tenancy {
  return {
    id: 't-1',
    workspace_id: 'ws-1',
    unit_id: 'unit-1',
    tenant_id: 'tenant-1',
    tenant_name: 'Someone',
    tenant_contact: null,
    start_date: '2026-01-01',
    end_date: null,
    rent_amount: 1000,
    notes: null,
    created_by_user_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('pickCurrentTenancy', () => {
  it('returns null for an empty list', () => {
    expect(pickCurrentTenancy([], TODAY)).toBeNull()
  })

  it('picks the single open-ended (month-to-month) tenancy', () => {
    const t = tenancy({ id: 'a', end_date: null })
    expect(pickCurrentTenancy([t], TODAY)?.id).toBe('a')
  })

  it('picks a tenancy whose end_date is still in the future', () => {
    const t = tenancy({ id: 'a', end_date: '2026-12-31' })
    expect(pickCurrentTenancy([t], TODAY)?.id).toBe('a')
  })

  it('treats end_date exactly today as still current', () => {
    const t = tenancy({ id: 'a', end_date: TODAY })
    expect(pickCurrentTenancy([t], TODAY)?.id).toBe('a')
  })

  it('falls back to a single already-ended tenancy rather than returning null', () => {
    // No CURRENT tenancy exists, but the list is not empty — the fallback returns
    // the (only) past lease rather than treating "nothing current" as "nothing at
    // all" (a former resident should still see their last home, not a blank state).
    const t = tenancy({ id: 'a', end_date: '2026-01-01' })
    expect(pickCurrentTenancy([t], TODAY)?.id).toBe('a')
  })

  it('prefers the most-recently-started of several currently-covering tenancies', () => {
    const older = tenancy({ id: 'older', start_date: '2025-01-01', end_date: null })
    const newer = tenancy({ id: 'newer', start_date: '2026-06-01', end_date: null })
    expect(pickCurrentTenancy([older, newer], TODAY)?.id).toBe('newer')
  })

  it('falls back to the most recently ENDED past lease when none is current', () => {
    const long_ago = tenancy({ id: 'long-ago', start_date: '2020-01-01', end_date: '2021-01-01' })
    const recent = tenancy({ id: 'recent', start_date: '2025-01-01', end_date: '2026-01-01' })
    expect(pickCurrentTenancy([long_ago, recent], TODAY)?.id).toBe('recent')
  })

  it('never picks a past lease when a current one exists, regardless of order', () => {
    const past = tenancy({ id: 'past', start_date: '2020-01-01', end_date: '2021-01-01' })
    const current = tenancy({ id: 'current', start_date: '2026-01-01', end_date: null })
    expect(pickCurrentTenancy([past, current], TODAY)?.id).toBe('current')
    expect(pickCurrentTenancy([current, past], TODAY)?.id).toBe('current')
  })

  it('is deterministic (tie-broken by id) when start_date/end_date tie', () => {
    const a = tenancy({ id: 'a', start_date: '2026-01-01', end_date: null })
    const b = tenancy({ id: 'b', start_date: '2026-01-01', end_date: null })
    expect(pickCurrentTenancy([b, a], TODAY)?.id).toBe(pickCurrentTenancy([a, b], TODAY)?.id)
  })
})
