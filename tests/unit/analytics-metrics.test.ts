import { describe, it, expect } from 'vitest'
import type { Ticket } from '@/lib/data/tickets'
import type { Vendor } from '@/lib/data/vendors'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'
import type {
  ExpenseRecord,
  IncomeRecord,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@/types/domain'
import {
  costOverview,
  costByCategory,
  costByProperty,
  vendorBenchmarks,
  problemUnits,
  cycleTimes,
  trends,
  profitPerUnit,
} from '@/lib/analytics/metrics'

// Minimal ticket factory — only the fields the metrics read matter; the rest are filled
// with type-satisfying defaults. Every metric function is exercised against these.
function ticket(
  partial: Partial<Ticket> & { id: string; property_id: string; created_at: string }
): Ticket {
  return {
    workspace_id: 'ws-1',
    unit_id: null,
    created_by_user_id: 'user-1',
    created_for_user_id: null,
    assigned_operator_id: null,
    assigned_vendor_id: null,
    title: 'Leaky tap',
    description: '',
    category: 'PLUMBING' as TicketCategory,
    priority: 'NORMAL' as TicketPriority,
    status: 'NEW' as TicketStatus,
    estimated_cost: null,
    actual_cost: null,
    scheduled_at: null,
    resolved_at: null,
    closed_at: null,
    updated_at: partial.created_at,
    ...partial,
  }
}

function vendor(id: string, company_name: string): Vendor {
  return {
    id,
    workspace_id: 'ws-1',
    company_name,
    contact_name: null,
    email: null,
    phone: null,
    service_category: 'PLUMBING',
    notes: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function unit(id: string, property_id: string, label: string): Unit {
  return {
    id,
    workspace_id: 'ws-1',
    property_id,
    label,
    floor: null,
    staircase: null,
    size_m2: null,
    room_count: null,
    occupancy_type: 'LONG_TERM',
    status: 'OCCUPIED',
    access_notes: null,
    wifi_info: null,
    heating_info: null,
    general_notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function income(partial: Partial<IncomeRecord> & { id: string; amount: number }): IncomeRecord {
  return {
    workspace_id: 'ws-1',
    property_id: null,
    unit_id: null,
    currency: 'EUR',
    category: 'RENT',
    period_start: '2026-06-01',
    period_end: null,
    notes: null,
    created_by_user_id: 'user-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...partial,
  }
}

function expense(
  partial: Partial<ExpenseRecord> & { id: string; amount: number }
): ExpenseRecord {
  return {
    workspace_id: 'ws-1',
    property_id: null,
    unit_id: null,
    currency: 'EUR',
    category: 'MAINTENANCE',
    incurred_on: '2026-06-01',
    ticket_id: null,
    notes: null,
    created_by_user_id: 'user-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...partial,
  }
}

function property(id: string, name: string): Property {
  return {
    id,
    workspace_id: 'ws-1',
    name,
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
  }
}

describe('costOverview', () => {
  it('sums actual/estimated and exposes only non-terminal estimates', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', status: 'IN_PROGRESS', estimated_cost: 100, actual_cost: null }),
      ticket({ id: 't2', property_id: 'p1', status: 'RESOLVED', estimated_cost: 200, actual_cost: 250 }),
      ticket({ id: 't3', property_id: 'p1', status: 'NEW', estimated_cost: 50, actual_cost: null }),
    ]
    expect(costOverview(tickets)).toEqual({
      totalActualCost: 250,
      totalEstimatedCost: 350,
      openCostExposure: 150, // t1 (100) + t3 (50); t2 is terminal
      variance: 250 - 350,
    })
  })

  it('returns zeros for empty input (no NaN)', () => {
    expect(costOverview([])).toEqual({
      totalActualCost: 0,
      totalEstimatedCost: 0,
      openCostExposure: 0,
      variance: 0,
    })
  })

  it('treats null costs as zero', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1', status: 'NEW' })]
    const r = costOverview(tickets)
    expect(r.totalActualCost).toBe(0)
    expect(r.openCostExposure).toBe(0)
    expect(Number.isNaN(r.variance)).toBe(false)
  })
})

describe('costByCategory', () => {
  it('totals actual cost per category, sorted desc', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', category: 'PLUMBING', actual_cost: 100 }),
      ticket({ id: 't2', property_id: 'p1', category: 'PLUMBING', actual_cost: 50 }),
      ticket({ id: 't3', property_id: 'p1', category: 'HEATING', actual_cost: 300 }),
      ticket({ id: 't4', property_id: 'p1', category: 'HEATING', actual_cost: null }),
    ]
    expect(costByCategory(tickets)).toEqual([
      { category: 'HEATING', total: 300, count: 2 },
      { category: 'PLUMBING', total: 150, count: 2 },
    ])
  })

  it('returns empty for empty input', () => {
    expect(costByCategory([])).toEqual([])
  })
})

describe('costByProperty', () => {
  it('totals by property and resolves the name', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', actual_cost: 100 }),
      ticket({ id: 't2', property_id: 'p2', actual_cost: 400 }),
      ticket({ id: 't3', property_id: 'p1', actual_cost: 50 }),
    ]
    const props = [property('p1', 'Alpha'), property('p2', 'Beta')]
    expect(costByProperty(tickets, props)).toEqual([
      { propertyId: 'p2', propertyName: 'Beta', total: 400, count: 1 },
      { propertyId: 'p1', propertyName: 'Alpha', total: 150, count: 2 },
    ])
  })

  it('falls back to a generic name for an unknown property', () => {
    const tickets = [ticket({ id: 't1', property_id: 'ghost', actual_cost: 10 })]
    expect(costByProperty(tickets, [])).toEqual([
      { propertyId: 'ghost', propertyName: 'Unknown property', total: 10, count: 1 },
    ])
  })
})

describe('vendorBenchmarks', () => {
  it('aggregates jobs, avg cost, avg cycle, open count per vendor', () => {
    const tickets = [
      ticket({
        id: 't1',
        property_id: 'p1',
        assigned_vendor_id: 'v1',
        status: 'CLOSED',
        actual_cost: 100,
        created_at: '2026-06-01T00:00:00Z',
        closed_at: '2026-06-03T00:00:00Z', // 2 days
      }),
      ticket({
        id: 't2',
        property_id: 'p1',
        assigned_vendor_id: 'v1',
        status: 'RESOLVED',
        actual_cost: 300,
        created_at: '2026-06-01T00:00:00Z',
        resolved_at: '2026-06-05T00:00:00Z', // 4 days
      }),
      ticket({ id: 't3', property_id: 'p1', assigned_vendor_id: 'v1', status: 'IN_PROGRESS' }),
      ticket({ id: 't4', property_id: 'p1', assigned_vendor_id: null, status: 'NEW' }),
    ]
    const vendors = [vendor('v1', 'Acme Plumbing')]
    expect(vendorBenchmarks(tickets, vendors)).toEqual([
      {
        vendorId: 'v1',
        name: 'Acme Plumbing',
        jobs: 3,
        avgActualCost: 200, // (100 + 300) / 2 — t3 has no cost
        avgCycleDays: 3, // (2 + 4) / 2
        openCount: 1, // t3
      },
    ])
  })

  it('sorts by jobs desc, ties by name', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', assigned_vendor_id: 'v1' }),
      ticket({ id: 't2', property_id: 'p1', assigned_vendor_id: 'v2' }),
      ticket({ id: 't3', property_id: 'p1', assigned_vendor_id: 'v2' }),
    ]
    const vendors = [vendor('v1', 'Zeta'), vendor('v2', 'Alpha')]
    const r = vendorBenchmarks(tickets, vendors)
    expect(r.map((v) => v.vendorId)).toEqual(['v2', 'v1'])
  })

  it('returns empty when no ticket is vendor-assigned', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1' })]
    expect(vendorBenchmarks(tickets, [vendor('v1', 'Acme')])).toEqual([])
  })

  it('reports null avg cost/cycle for a vendor with no cost or completed work', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1', assigned_vendor_id: 'v1', status: 'NEW' })]
    expect(vendorBenchmarks(tickets, [vendor('v1', 'Acme')])).toEqual([
      { vendorId: 'v1', name: 'Acme', jobs: 1, avgActualCost: null, avgCycleDays: null, openCount: 1 },
    ])
  })
})

describe('problemUnits', () => {
  it('ranks units by ticket count then cost and caps at topN', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', unit_id: 'u1', actual_cost: 100 }),
      ticket({ id: 't2', property_id: 'p1', unit_id: 'u1', actual_cost: 50 }),
      ticket({ id: 't3', property_id: 'p1', unit_id: 'u2', actual_cost: 999 }),
      ticket({ id: 't4', property_id: 'p1', unit_id: null, actual_cost: 10 }),
    ]
    const units = [unit('u1', 'p1', '1A'), unit('u2', 'p1', '2B')]
    const props = [property('p1', 'Alpha')]
    expect(problemUnits(tickets, units, props, 5)).toEqual([
      { unitId: 'u1', label: '1A', propertyName: 'Alpha', ticketCount: 2, totalCost: 150 },
      { unitId: 'u2', label: '2B', propertyName: 'Alpha', ticketCount: 1, totalCost: 999 },
    ])
  })

  it('honours topN', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', unit_id: 'u1' }),
      ticket({ id: 't2', property_id: 'p1', unit_id: 'u2' }),
    ]
    const units = [unit('u1', 'p1', '1A'), unit('u2', 'p1', '2B')]
    expect(problemUnits(tickets, units, [], 1)).toHaveLength(1)
  })

  it('returns empty when no ticket carries a unit', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: null })]
    expect(problemUnits(tickets, [], [])).toEqual([])
  })
})

describe('cycleTimes', () => {
  it('averages resolve days overall and by priority', () => {
    const tickets = [
      ticket({
        id: 't1',
        property_id: 'p1',
        priority: 'HIGH',
        status: 'RESOLVED',
        created_at: '2026-06-01T00:00:00Z',
        resolved_at: '2026-06-03T00:00:00Z', // 2
      }),
      ticket({
        id: 't2',
        property_id: 'p1',
        priority: 'HIGH',
        status: 'CLOSED',
        created_at: '2026-06-01T00:00:00Z',
        closed_at: '2026-06-05T00:00:00Z', // 4
      }),
      ticket({ id: 't3', property_id: 'p1', priority: 'LOW', status: 'NEW' }), // unresolved
    ]
    const r = cycleTimes(tickets)
    expect(r.avgResolveDays).toBe(3)
    expect(r.byPriority.HIGH).toBe(3)
    expect(r.byPriority.LOW).toBeNull()
    expect(r.byPriority.NORMAL).toBeNull()
    expect(r.byPriority.URGENT).toBeNull()
  })

  it('returns nulls for empty input (no NaN)', () => {
    const r = cycleTimes([])
    expect(r.avgResolveDays).toBeNull()
    expect(r.byPriority).toEqual({ LOW: null, NORMAL: null, HIGH: null, URGENT: null })
  })
})

describe('trends', () => {
  const NOW = new Date('2026-06-15T00:00:00Z')

  it('buckets opened/resolved/spend over the last 6 months, oldest first, zero-filled', () => {
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', created_at: '2026-06-02T00:00:00Z' }), // opened Jun
      ticket({
        id: 't2',
        property_id: 'p1',
        status: 'RESOLVED',
        created_at: '2026-05-01T00:00:00Z', // opened May
        resolved_at: '2026-06-10T00:00:00Z', // resolved Jun
        actual_cost: 500,
      }),
    ]
    const r = trends(tickets, NOW, 6)
    expect(r.map((b) => b.month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ])
    const jun = r.find((b) => b.month === '2026-06')!
    const may = r.find((b) => b.month === '2026-05')!
    expect(jun).toEqual({ month: '2026-06', opened: 1, resolved: 1, spend: 500 })
    expect(may).toEqual({ month: '2026-05', opened: 1, resolved: 0, spend: 0 })
  })

  it('ignores tickets outside the window', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1', created_at: '2025-01-01T00:00:00Z' })]
    const r = trends(tickets, NOW, 6)
    expect(r.every((b) => b.opened === 0 && b.resolved === 0 && b.spend === 0)).toBe(true)
  })

  it('returns a zero-filled window for empty input', () => {
    const r = trends([], NOW, 6)
    expect(r).toHaveLength(6)
    expect(r.every((b) => b.opened === 0 && b.resolved === 0 && b.spend === 0)).toBe(true)
  })
})

describe('profitPerUnit', () => {
  const units = [unit('u1', 'p1', '1A'), unit('u2', 'p1', '2B')]
  const props = [property('p1', 'Alpha')]

  it('nets income minus expense + ticket cost per unit, sorted by profit desc', () => {
    const incomes = [
      income({ id: 'i1', unit_id: 'u1', amount: 1000 }),
      income({ id: 'i2', unit_id: 'u1', amount: 200 }),
      income({ id: 'i3', unit_id: 'u2', amount: 800 }),
    ]
    const expenses = [expense({ id: 'e1', unit_id: 'u1', amount: 150 })]
    const tickets = [
      ticket({ id: 't1', property_id: 'p1', unit_id: 'u1', actual_cost: 100 }),
      ticket({ id: 't2', property_id: 'p1', unit_id: 'u2', actual_cost: 50 }),
    ]
    expect(profitPerUnit(incomes, expenses, tickets, units, props)).toEqual([
      { unitId: 'u2', label: '2B', propertyName: 'Alpha', income: 800, cost: 50, profit: 750 },
      { unitId: 'u1', label: '1A', propertyName: 'Alpha', income: 1200, cost: 250, profit: 950 - 0 },
    ].sort((a, b) => b.profit - a.profit))
  })

  it('dedupes a ticket cost that an expense_record already accounts for', () => {
    const incomes = [income({ id: 'i1', unit_id: 'u1', amount: 500 })]
    // e1 links ticket t1 — its actual_cost is superseded, so only the 300 expense counts.
    const expenses = [expense({ id: 'e1', unit_id: 'u1', amount: 300, ticket_id: 't1' })]
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: 'u1', actual_cost: 999 })]
    const r = profitPerUnit(incomes, expenses, tickets, units, props)
    expect(r).toEqual([
      { unitId: 'u1', label: '1A', propertyName: 'Alpha', income: 500, cost: 300, profit: 200 },
    ])
  })

  it('counts a ticket cost when its expense links a different ticket', () => {
    const expenses = [expense({ id: 'e1', unit_id: 'u1', amount: 100, ticket_id: 't-other' })]
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: 'u1', actual_cost: 40 })]
    const r = profitPerUnit([], expenses, tickets, units, props)
    // 100 (expense) + 40 (unsuperseded ticket) = 140 cost, 0 income.
    expect(r).toEqual([
      { unitId: 'u1', label: '1A', propertyName: 'Alpha', income: 0, cost: 140, profit: -140 },
    ])
  })

  it('shows a cost-only unit with negative profit and no income row', () => {
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: 'u2', actual_cost: 75 })]
    const r = profitPerUnit([], [], tickets, units, props)
    expect(r).toEqual([
      { unitId: 'u2', label: '2B', propertyName: 'Alpha', income: 0, cost: 75, profit: -75 },
    ])
  })

  it('ignores income/expense/tickets with no unit_id', () => {
    const incomes = [income({ id: 'i1', unit_id: null, amount: 500 })]
    const expenses = [expense({ id: 'e1', unit_id: null, amount: 100 })]
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: null, actual_cost: 40 })]
    expect(profitPerUnit(incomes, expenses, tickets, units, props)).toEqual([])
  })

  it('treats null amounts/costs as zero (no NaN)', () => {
    const incomes = [income({ id: 'i1', unit_id: 'u1', amount: 0 })]
    const tickets = [ticket({ id: 't1', property_id: 'p1', unit_id: 'u1', actual_cost: null })]
    const r = profitPerUnit(incomes, [], tickets, units, props)
    expect(r).toEqual([
      { unitId: 'u1', label: '1A', propertyName: 'Alpha', income: 0, cost: 0, profit: 0 },
    ])
    expect(Number.isNaN(r[0].profit)).toBe(false)
  })

  it('falls back to generic labels for an unknown unit', () => {
    const incomes = [income({ id: 'i1', unit_id: 'ghost', amount: 100 })]
    expect(profitPerUnit(incomes, [], [], [], [])).toEqual([
      { unitId: 'ghost', label: 'Unknown unit', propertyName: 'Unknown property', income: 100, cost: 0, profit: 100 },
    ])
  })

  it('returns empty for fully empty input', () => {
    expect(profitPerUnit([], [], [], [], [])).toEqual([])
  })
})
