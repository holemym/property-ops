import { describe, it, expect } from 'vitest'
import type { Tenancy } from '@/types/domain'
import { buildUnitTimeline, defaultWindow, type DateWindow } from '@/lib/occupancy/timeline'

// A 6-month window used by most fixtures: [2026-01-01, 2026-07-01).
const WIN: DateWindow = { from: '2026-01-01', to: '2026-07-01' }

// Minimal tenancy factory — only the fields buildUnitTimeline reads matter; the rest
// are filled with defaults to satisfy the Tenancy type.
function tenancy(partial: Partial<Tenancy> & { id: string; tenant_name: string; start_date: string }): Tenancy {
  return {
    workspace_id: 'ws-1',
    unit_id: 'unit-1',
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

describe('buildUnitTimeline', () => {
  it('fully-occupied unit: one OCCUPIED segment spanning the window', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2025-12-01', end_date: '2026-08-01' })]
    expect(buildUnitTimeline('OCCUPIED', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'OCCUPIED', tenantName: 'Alice' },
    ])
  })

  it('mid-window turnover: occupied then vacant', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2025-11-01', end_date: '2026-04-01' })]
    expect(buildUnitTimeline('VACANT', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-04-01', state: 'OCCUPIED', tenantName: 'Alice' },
      { from: '2026-04-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('mid-window turnover: vacant then occupied then vacant (move-in mid window)', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Bob', start_date: '2026-03-01', end_date: '2026-05-01' })]
    expect(buildUnitTimeline('VACANT', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-03-01', state: 'VACANT' },
      { from: '2026-03-01', to: '2026-05-01', state: 'OCCUPIED', tenantName: 'Bob' },
      { from: '2026-05-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('open-ended tenancy (end_date null) covers to the window end', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Carol', start_date: '2026-02-01', end_date: null })]
    expect(buildUnitTimeline('OCCUPIED', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-02-01', state: 'VACANT' },
      { from: '2026-02-01', to: '2026-07-01', state: 'OCCUPIED', tenantName: 'Carol' },
    ])
  })

  it('MAINTENANCE unit: whole-window override regardless of tenancies', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: null })]
    expect(buildUnitTimeline('MAINTENANCE', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'MAINTENANCE' },
    ])
  })

  it('BLOCKED unit: whole-window override regardless of tenancies', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: null })]
    expect(buildUnitTimeline('BLOCKED', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'BLOCKED' },
    ])
  })

  it('no tenancies: entire window VACANT', () => {
    expect(buildUnitTimeline('VACANT', [], WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('tenancy entirely before the window is ignored', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Old', start_date: '2025-01-01', end_date: '2025-06-01' })]
    expect(buildUnitTimeline('VACANT', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('tenancy entirely after the window is ignored', () => {
    const t = [tenancy({ id: 't1', tenant_name: 'Future', start_date: '2027-01-01', end_date: '2027-06-01' })]
    expect(buildUnitTimeline('VACANT', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('overlapping tenancies: OCCUPIED wins, earliest-starting tenant name is carried in the overlap', () => {
    // Alice 2026-01-01..2026-04-01, Bob 2026-03-01..2026-06-01 overlap Mar–Apr. No
    // vacancy across the union [Jan, Jun); Jun–Jul is VACANT. In the overlap [Mar, Apr)
    // both cover, so the earliest-starting tenant (Alice) wins the name, per the
    // documented deterministic tie-break — that Alice run then merges into [Jan, Apr).
    // From Apr only Bob covers, so [Apr, Jun) carries Bob.
    const t = [
      tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: '2026-04-01' }),
      tenancy({ id: 't2', tenant_name: 'Bob', start_date: '2026-03-01', end_date: '2026-06-01' }),
    ]
    expect(buildUnitTimeline('OCCUPIED', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-04-01', state: 'OCCUPIED', tenantName: 'Alice' },
      { from: '2026-04-01', to: '2026-06-01', state: 'OCCUPIED', tenantName: 'Bob' },
      { from: '2026-06-01', to: '2026-07-01', state: 'VACANT' },
    ])
  })

  it('back-to-back tenancies of different tenants are NOT merged (name changes)', () => {
    const t = [
      tenancy({ id: 't1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: '2026-04-01' }),
      tenancy({ id: 't2', tenant_name: 'Bob', start_date: '2026-04-01', end_date: '2026-07-01' }),
    ]
    expect(buildUnitTimeline('OCCUPIED', t, WIN)).toEqual([
      { from: '2026-01-01', to: '2026-04-01', state: 'OCCUPIED', tenantName: 'Alice' },
      { from: '2026-04-01', to: '2026-07-01', state: 'OCCUPIED', tenantName: 'Bob' },
    ])
  })

  it('empty/inverted window yields no segments', () => {
    expect(buildUnitTimeline('VACANT', [], { from: '2026-07-01', to: '2026-01-01' })).toEqual([])
  })
})

describe('defaultWindow', () => {
  it('returns 6 months starting at the first of the current month (UTC)', () => {
    expect(defaultWindow(new Date('2026-07-07T12:00:00Z'))).toEqual({
      from: '2026-07-01',
      to: '2027-01-01',
    })
  })

  it('rolls the year over correctly for late-year months', () => {
    expect(defaultWindow(new Date('2026-11-15T00:00:00Z'))).toEqual({
      from: '2026-11-01',
      to: '2027-05-01',
    })
  })
})
