import { describe, it, expect } from 'vitest'
import type { Tenancy } from '@/types/domain'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'
import {
  rentRoll,
  expiringLeases,
  totalMonthlyRent,
  type RentRollRow,
} from '@/lib/occupancy/rent-roll'

// Fixture factories — only the fields the helpers read matter; the rest satisfy the
// domain types with inert defaults.
function tenancy(
  partial: Partial<Tenancy> & { id: string; unit_id: string; tenant_name: string; start_date: string }
): Tenancy {
  return {
    workspace_id: 'ws-1',
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

function unit(partial: Partial<Unit> & { id: string; property_id: string; label: string }): Unit {
  return {
    workspace_id: 'ws-1',
    floor: null,
    staircase: null,
    size_m2: null,
    room_count: null,
    occupancy_type: 'LONG_TERM',
    status: 'VACANT',
    access_notes: null,
    wifi_info: null,
    heating_info: null,
    general_notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

function property(partial: Partial<Property> & { id: string; name: string }): Property {
  return {
    workspace_id: 'ws-1',
    address_line1: '1 Main St',
    address_line2: null,
    city: 'Vienna',
    postal_code: '1010',
    country: 'AT',
    property_type: 'APARTMENT_BUILDING',
    notes: null,
    status: 'ACTIVE',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

const AS_OF = new Date('2026-07-07T12:00:00Z')

describe('rentRoll', () => {
  it('marks a unit OCCUPIED and carries the covering tenancy tenant/rent/dates', () => {
    const props = [property({ id: 'p1', name: 'Ostgasse' })]
    const units = [unit({ id: 'u1', property_id: 'p1', label: 'Top 1' })]
    const tenancies = [
      tenancy({
        id: 't1',
        unit_id: 'u1',
        tenant_name: 'Alice',
        start_date: '2026-01-01',
        end_date: '2026-12-31',
        rent_amount: 1200,
      }),
    ]
    expect(rentRoll(units, tenancies, props, AS_OF)).toEqual<RentRollRow[]>([
      {
        unitId: 'u1',
        label: 'Top 1',
        propertyName: 'Ostgasse',
        status: 'OCCUPIED',
        tenantName: 'Alice',
        rent: 1200,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
      },
    ])
  })

  it('marks a unit VACANT when no tenancy covers asOf', () => {
    const props = [property({ id: 'p1', name: 'Ostgasse' })]
    const units = [unit({ id: 'u1', property_id: 'p1', label: 'Top 1' })]
    // Lease ended before asOf.
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Bob', start_date: '2025-01-01', end_date: '2026-01-01' }),
    ]
    expect(rentRoll(units, tenancies, props, AS_OF)).toEqual<RentRollRow[]>([
      { unitId: 'u1', label: 'Top 1', propertyName: 'Ostgasse', status: 'VACANT' },
    ])
  })

  it('treats an open-ended lease (end_date null) as covering', () => {
    const props = [property({ id: 'p1', name: 'Ostgasse' })]
    const units = [unit({ id: 'u1', property_id: 'p1', label: 'Top 1' })]
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Carol', start_date: '2026-05-01', end_date: null, rent_amount: 900 }),
    ]
    const rows = rentRoll(units, tenancies, props, AS_OF)
    expect(rows[0].status).toBe('OCCUPIED')
    expect(rows[0].tenantName).toBe('Carol')
    expect(rows[0].leaseEnd).toBeNull()
    expect(rows[0].rent).toBe(900)
  })

  it('leaves rent undefined when the covering tenancy has null rent', () => {
    const props = [property({ id: 'p1', name: 'Ostgasse' })]
    const units = [unit({ id: 'u1', property_id: 'p1', label: 'Top 1' })]
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Dana', start_date: '2026-01-01', end_date: null, rent_amount: null }),
    ]
    expect(rentRoll(units, tenancies, props, AS_OF)[0].rent).toBeUndefined()
  })

  it('picks the earliest-starting covering tenancy on overlap (tie-break by id)', () => {
    const props = [property({ id: 'p1', name: 'Ostgasse' })]
    const units = [unit({ id: 'u1', property_id: 'p1', label: 'Top 1' })]
    const tenancies = [
      tenancy({ id: 't2', unit_id: 'u1', tenant_name: 'Later', start_date: '2026-06-01', end_date: null, rent_amount: 1500 }),
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Earlier', start_date: '2026-01-01', end_date: null, rent_amount: 1000 }),
    ]
    const row = rentRoll(units, tenancies, props, AS_OF)[0]
    expect(row.tenantName).toBe('Earlier')
    expect(row.rent).toBe(1000)
  })

  it('sorts by property name then unit label', () => {
    const props = [property({ id: 'pB', name: 'Bravo' }), property({ id: 'pA', name: 'Alpha' })]
    const units = [
      unit({ id: 'u1', property_id: 'pB', label: 'Top 2' }),
      unit({ id: 'u2', property_id: 'pA', label: 'Top 9' }),
      unit({ id: 'u3', property_id: 'pA', label: 'Top 1' }),
    ]
    const rows = rentRoll(units, [], props, AS_OF)
    expect(rows.map((r) => [r.propertyName, r.label])).toEqual([
      ['Alpha', 'Top 1'],
      ['Alpha', 'Top 9'],
      ['Bravo', 'Top 2'],
    ])
  })

  it('falls back to "Unknown property" when the unit property is missing', () => {
    const units = [unit({ id: 'u1', property_id: 'ghost', label: 'Top 1' })]
    expect(rentRoll(units, [], [], AS_OF)[0].propertyName).toBe('Unknown property')
  })

  it('returns [] for no units', () => {
    expect(rentRoll([], [], [], AS_OF)).toEqual([])
  })
})

describe('expiringLeases', () => {
  it('includes leases ending within the window, sorted soonest-first', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Alice', start_date: '2025-01-01', end_date: '2026-09-01' }),
      tenancy({ id: 't2', unit_id: 'u2', tenant_name: 'Bob', start_date: '2025-01-01', end_date: '2026-07-20' }),
    ]
    const out = expiringLeases(tenancies, AS_OF, 90)
    expect(out.map((e) => e.tenantName)).toEqual(['Bob', 'Alice'])
    // 2026-07-07 -> 2026-07-20 is 13 days.
    expect(out[0]).toEqual({ unitId: 'u2', tenantName: 'Bob', leaseEnd: '2026-07-20', daysLeft: 13 })
  })

  it('excludes leases ending beyond the window', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Alice', start_date: '2025-01-01', end_date: '2027-01-01' }),
    ]
    expect(expiringLeases(tenancies, AS_OF, 90)).toEqual([])
  })

  it('excludes leases that already ended before asOf and open-ended leases', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Past', start_date: '2025-01-01', end_date: '2026-06-01' }),
      tenancy({ id: 't2', unit_id: 'u2', tenant_name: 'OpenEnded', start_date: '2025-01-01', end_date: null }),
    ]
    expect(expiringLeases(tenancies, AS_OF, 90)).toEqual([])
  })

  it('includes a lease ending exactly today with daysLeft 0', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'u1', tenant_name: 'Today', start_date: '2025-01-01', end_date: '2026-07-07' }),
    ]
    expect(expiringLeases(tenancies, AS_OF, 90)[0]).toEqual({
      unitId: 'u1',
      tenantName: 'Today',
      leaseEnd: '2026-07-07',
      daysLeft: 0,
    })
  })

  it('returns [] for no tenancies', () => {
    expect(expiringLeases([], AS_OF)).toEqual([])
  })
})

describe('totalMonthlyRent', () => {
  it('sums rent of OCCUPIED rows only', () => {
    const rows: RentRollRow[] = [
      { unitId: 'u1', label: 'A', propertyName: 'P', status: 'OCCUPIED', rent: 1000 },
      { unitId: 'u2', label: 'B', propertyName: 'P', status: 'OCCUPIED', rent: 1500 },
      { unitId: 'u3', label: 'C', propertyName: 'P', status: 'VACANT' },
    ]
    expect(totalMonthlyRent(rows)).toBe(2500)
  })

  it('treats missing rent as 0 and never returns NaN', () => {
    const rows: RentRollRow[] = [
      { unitId: 'u1', label: 'A', propertyName: 'P', status: 'OCCUPIED' },
      { unitId: 'u2', label: 'B', propertyName: 'P', status: 'OCCUPIED', rent: 800 },
    ]
    const total = totalMonthlyRent(rows)
    expect(total).toBe(800)
    expect(Number.isNaN(total)).toBe(false)
  })

  it('returns 0 for an empty list', () => {
    expect(totalMonthlyRent([])).toBe(0)
  })
})
