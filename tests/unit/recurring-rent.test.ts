import { describe, it, expect } from 'vitest'
import type { Tenancy } from '@/types/domain'
import {
  computeRentInvoicePlan,
  type ExistingInvoiceKey,
  type RecurringUnitRef,
} from '@/lib/invoices/recurring'

// Minimal tenancy factory — only the fields the planner reads matter; the rest are
// filled with defaults to satisfy the Tenancy type. Mirrors the factory style in
// tests/unit/occupancy-timeline.test.ts.
function tenancy(
  partial: Partial<Tenancy> & { id: string; unit_id: string; tenant_name: string; start_date: string },
): Tenancy {
  return {
    workspace_id: 'ws-1',
    tenant_id: null,
    tenant_contact: null,
    end_date: null,
    rent_amount: 1000,
    notes: null,
    created_by_user_id: 'user-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

const UNITS: RecurringUnitRef[] = [
  { id: 'unit-1', propertyId: 'prop-1' },
  { id: 'unit-2', propertyId: 'prop-2' },
]

const TODAY = new Date('2026-07-20T00:00:00Z')

describe('computeRentInvoicePlan — qualification: month overlap', () => {
  it('a tenancy fully inside the month is planned', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', end_date: '2026-07-31' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toCreate[0].tenancyId).toBe('t1')
  })

  it('starts mid-month — still overlaps and is planned', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-15', end_date: null })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('starts after the month ends — excluded, not counted in either skip bucket', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-08-01', end_date: null })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.skippedExisting).toBe(0)
    expect(plan.skippedNoRent).toBe(0)
  })

  it('ends on the first of the month (boundary, inclusive convention) — still overlaps that month', () => {
    // Moved out 2026-07-01: the closed-interval overlap test (end_date inclusive,
    // matching rent-roll.ts's `end_date >= asOf`) counts July as overlapped because the
    // last day of the tenancy falls inside it.
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-06-01', end_date: '2026-07-01' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('ends on the first of the month — ALSO still overlaps the prior month (both boundaries)', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-06-01', end_date: '2026-07-01' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-06', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('ends the day before the month starts — excluded', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-05-01', end_date: '2026-06-30' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(0)
  })

  it('open-ended tenancy (end_date null) overlaps any month at/after its start', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: null })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2027-01', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('respects a leap-year February month-end boundary', () => {
    // 2028 is a leap year: Feb has 29 days. A tenancy ending 2028-02-29 must overlap
    // Feb 2028 (inclusive last day) but a tenancy starting 2028-03-01 must not.
    const endsOnLeapDay = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2028-02-01', end_date: '2028-02-29' })
    const startsMarch1 = tenancy({ id: 't2', unit_id: 'unit-1', tenant_name: 'Bob', start_date: '2028-03-01', end_date: null })
    const plan = computeRentInvoicePlan([endsOnLeapDay, startsMarch1], UNITS, [], '2028-02', TODAY)
    expect(plan.toCreate.map((p) => p.tenancyId)).toEqual(['t1'])
  })
})

describe('computeRentInvoicePlan — qualification: rent_amount', () => {
  it('null rent_amount is skipped as no-rent', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: null })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.skippedNoRent).toBe(1)
  })

  it('zero rent_amount is skipped as no-rent (not billed for €0)', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: 0 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.skippedNoRent).toBe(1)
  })

  it('negative rent_amount is skipped as no-rent', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: -50 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.skippedNoRent).toBe(1)
  })

  it('non-finite rent_amount is skipped as no-rent', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: Number.POSITIVE_INFINITY })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.skippedNoRent).toBe(1)
  })

  it('a positive finite rent_amount is billable', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: 1250.5 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate[0].lines[0].unitAmount).toBe(1250.5)
  })
})

describe('computeRentInvoicePlan — qualification: dedupe against existing invoices', () => {
  it('a non-VOID existing invoice for (tenancy, month) is skipped', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't1', billingPeriod: '2026-07-01', status: 'SENT' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.skippedExisting).toBe(1)
  })

  it('a DRAFT existing invoice for (tenancy, month) is skipped (any non-VOID status blocks)', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't1', billingPeriod: '2026-07-01', status: 'DRAFT' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.skippedExisting).toBe(1)
  })

  it('a VOIDed existing invoice for (tenancy, month) does NOT block — regenerated', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't1', billingPeriod: '2026-07-01', status: 'VOID' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.skippedExisting).toBe(0)
  })

  it('an existing invoice for a DIFFERENT month does not block this month', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-06-01', end_date: null })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't1', billingPeriod: '2026-06-01', status: 'SENT' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('an existing invoice for a DIFFERENT tenancy does not block this one', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't-other', billingPeriod: '2026-07-01', status: 'SENT' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(1)
  })

  it('regenerating an already-fully-billed month skips everything (idempotent re-click)', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' }),
      tenancy({ id: 't2', unit_id: 'unit-2', tenant_name: 'Bob', start_date: '2026-07-01' }),
    ]
    const existing: ExistingInvoiceKey[] = [
      { tenancyId: 't1', billingPeriod: '2026-07-01', status: 'DRAFT' },
      { tenancyId: 't2', billingPeriod: '2026-07-01', status: 'PAID' },
    ]
    const plan = computeRentInvoicePlan(tenancies, UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.skippedExisting).toBe(2)
  })
})

describe('computeRentInvoicePlan — check ordering when a tenancy fails multiple rules', () => {
  it('no-rent is checked before existing — a no-rent tenancy with a stale existing key counts as skippedNoRent', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: null })
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't1', billingPeriod: '2026-07-01', status: 'SENT' }]
    const plan = computeRentInvoicePlan([t], UNITS, existing, '2026-07', TODAY)
    expect(plan.skippedNoRent).toBe(1)
    expect(plan.skippedExisting).toBe(0)
  })
})

describe('computeRentInvoicePlan — planned invoice shape', () => {
  it('sets party_type/direction/status/currency and derives billing_period/issue_date/due_date', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: 900 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    const p = plan.toCreate[0]
    expect(p.partyType).toBe('TENANT')
    expect(p.direction).toBe('OUTBOUND')
    expect(p.status).toBe('DRAFT')
    expect(p.currency).toBe('EUR')
    expect(p.billingPeriod).toBe('2026-07-01')
    expect(p.issueDate).toBe('2026-07-20') // TODAY
    expect(p.dueDate).toBe('2026-08-03') // TODAY + 14 days
  })

  it('due_date correctly rolls over a month boundary', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-01-01', rent_amount: 500 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-01', new Date('2026-01-20T00:00:00Z'))
    expect(plan.toCreate[0].issueDate).toBe('2026-01-20')
    expect(plan.toCreate[0].dueDate).toBe('2026-02-03')
  })

  it('emits one line item: "Rent — <Month YYYY>", qty 1, unit_amount = rent_amount', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: 1234.56 })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate[0].lines).toEqual([
      { description: 'Rent — Jul 2026', quantity: 1, unitAmount: 1234.56 },
    ])
  })

  it('resolves property_id from the unit', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-2', tenant_name: 'Alice', start_date: '2026-07-01' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate[0].unitId).toBe('unit-2')
    expect(plan.toCreate[0].propertyId).toBe('prop-2')
  })

  it('degrades to a null property_id when the unit is not found (does not throw)', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-missing', tenant_name: 'Alice', start_date: '2026-07-01' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate[0].propertyId).toBeNull()
  })

  it('party_name falls back to tenant_name when tenant_id is null', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice Fallback', start_date: '2026-07-01', tenant_id: null })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY)
    expect(plan.toCreate[0].partyName).toBe('Alice Fallback')
  })

  it('party_name prefers the linked tenant directory full_name when tenant_id resolves', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Old Display Name', start_date: '2026-07-01', tenant_id: 'tenant-1' })
    const tenantNames = new Map([['tenant-1', 'Alice Directory Name']])
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY, tenantNames)
    expect(plan.toCreate[0].partyName).toBe('Alice Directory Name')
  })

  it('party_name falls back to tenant_name when tenant_id is set but not found in the lookup', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Fallback Name', start_date: '2026-07-01', tenant_id: 'tenant-missing' })
    const plan = computeRentInvoicePlan([t], UNITS, [], '2026-07', TODAY, new Map())
    expect(plan.toCreate[0].partyName).toBe('Fallback Name')
  })
})

describe('computeRentInvoicePlan — multi-tenancy + empty-input behaviour', () => {
  it('plans a mix of qualifying and disqualified tenancies with correct counts', () => {
    const tenancies = [
      tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01', rent_amount: 1000 }), // qualifies
      tenancy({ id: 't2', unit_id: 'unit-2', tenant_name: 'Bob', start_date: '2026-07-01', rent_amount: null }), // no rent
      tenancy({ id: 't3', unit_id: 'unit-1', tenant_name: 'Carol', start_date: '2026-01-01', end_date: '2026-06-30' }), // out of range
      tenancy({ id: 't4', unit_id: 'unit-2', tenant_name: 'Dave', start_date: '2026-07-01', rent_amount: 800 }), // already billed
    ]
    const existing: ExistingInvoiceKey[] = [{ tenancyId: 't4', billingPeriod: '2026-07-01', status: 'PAID' }]
    const plan = computeRentInvoicePlan(tenancies, UNITS, existing, '2026-07', TODAY)
    expect(plan.toCreate.map((p) => p.tenancyId)).toEqual(['t1'])
    expect(plan.skippedNoRent).toBe(1)
    expect(plan.skippedExisting).toBe(1)
  })

  it('is empty-safe: no tenancies yields an empty plan and zero counters', () => {
    const plan = computeRentInvoicePlan([], UNITS, [], '2026-07', TODAY)
    expect(plan).toEqual({ toCreate: [], skippedExisting: 0, skippedNoRent: 0 })
  })
})

describe('computeRentInvoicePlan — malformed month input', () => {
  it('throws on a non YYYY-MM month string', () => {
    const t = tenancy({ id: 't1', unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-07-01' })
    expect(() => computeRentInvoicePlan([t], UNITS, [], '2026-07-01', TODAY)).toThrow()
    expect(() => computeRentInvoicePlan([t], UNITS, [], 'July 2026', TODAY)).toThrow()
    expect(() => computeRentInvoicePlan([t], UNITS, [], '', TODAY)).toThrow()
  })
})
