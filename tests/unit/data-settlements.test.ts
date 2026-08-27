import { describe, it, expect } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { persistAllocationRun } from '@/lib/data/settlements'

// The PERSISTENCE half of the Betriebskosten money engine: it turns an allocation
// into settlement_unit_allocations rows — what a real Austrian tenant is actually
// billed. This file exists because an adversarial review found two defects here that
// the pure-engine tests could never see, and both fixes were, until now, verified by
// READING rather than by test. U-C stacks annual reconciliation on top of this, so
// each case below pins a specific way the money can go to the wrong unit.
//
// The recurring lesson from every money defect found so far: they all CONSERVED TO
// THE CENT. The totals were right and only the recipients were wrong, so a sum check
// alone proves nothing. These tests assert per-unit outcomes, not just totals.

const WS = 'ws-1'
const PROP = 'prop-1'
const PERIOD = 'period-1'
const USER = 'user-1'

type SeedOpts = {
  units?: Array<{ id: string; label: string; usable_area_m2: number | null }>
  positions?: Array<{ category: string; amount: number }>
  rules?: Array<Record<string, unknown>>
  meters?: Array<{ id: string; unit_id: string; kind: string; is_active: boolean; multiplier?: number }>
  readings?: Array<{ meter_id: string; reading_date: string; value: number }>
}

function seed(opts: SeedOpts = {}) {
  const units = opts.units ?? [
    { id: 'u1', label: 'Top 1', usable_area_m2: 60 },
    { id: 'u2', label: 'Top 2', usable_area_m2: 40 },
  ]
  return createFakeSupabaseClient({
    settlement_periods: [
      {
        id: PERIOD,
        workspace_id: WS,
        property_id: PROP,
        period_start: '2026-01-01',
        period_end: '2026-12-31',
        status: 'DRAFT',
      },
    ],
    units: units.map((u) => ({
      ...u,
      workspace_id: WS,
      property_id: PROP,
      status: 'OCCUPIED',
      created_at: '2026-01-01T00:00:00.000Z',
    })),
    settlement_cost_positions: (opts.positions ?? [{ category: 'CLEANING', amount: 1000 }]).map(
      (p, i) => ({
        id: `cp-${i}`,
        workspace_id: WS,
        settlement_period_id: PERIOD,
        ...p,
      }),
    ),
    settlement_allocation_rules: (opts.rules ?? [
      {
        category: null,
        basis: 'USABLE_AREA',
        owner_deduction_pct: 0,
        consumption_split_pct: null,
        base_split_basis: null,
        heat_split_min_pct: null,
        heat_split_max_pct: null,
      },
    ]).map((r, i) => ({
      id: `rule-${i}`,
      workspace_id: WS,
      settlement_period_id: PERIOD,
      ...r,
    })),
    meters: (opts.meters ?? []).map((m) => ({
      workspace_id: WS,
      property_id: PROP,
      multiplier: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      ...m,
    })),
    meter_readings: (opts.readings ?? []).map((r, i) => ({
      id: `mr-${i}`,
      workspace_id: WS,
      source: 'MANUAL',
      ...r,
    })),
    settlement_unit_allocations: [],
  })
}

const HEAT_RULE = {
  category: 'HEATING',
  basis: 'CONSUMPTION',
  owner_deduction_pct: 0,
  consumption_split_pct: 60,
  base_split_basis: 'USABLE_AREA',
  heat_split_min_pct: 55,
  heat_split_max_pct: 75,
}

describe('persistAllocationRun - area basis', () => {
  it('writes one row per unit whose amounts reconcile to the allocatable total', () => {
    return (async () => {
      const db = seed()
      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)

      expect(result.ok).toBe(true)
      expect(allocations).toHaveLength(2)
      const sum = allocations.reduce((s, a) => s + Number(a.amount), 0)
      expect(sum).toBeCloseTo(result.allocatableTotalCents / 100, 6)
      // Per-unit, not just the total: 60/40 area split of EUR 1000.
      const byUnit = Object.fromEntries(allocations.map((a) => [a.unit_id, Number(a.amount)]))
      expect(byUnit.u1).toBeCloseTo(600, 6)
      expect(byUnit.u2).toBeCloseTo(400, 6)
    })()
  })

  it('persists AREA as the basis value for an area-basis position', () => {
    return (async () => {
      const db = seed()
      const { allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      const u1 = allocations.find((a) => a.unit_id === 'u1')!
      // dm2ToM2 round-trips back to the unit's own Nutzflaeche.
      expect(Number(u1.unit_basis_value)).toBeCloseTo(60, 6)
      expect(Number(u1.total_basis_value)).toBeCloseTo(100, 6)
    })()
  })

  it('persists NOTHING for a blocked run', () => {
    return (async () => {
      // A null usable_area blocks the whole run (fail-closed) — a half-written
      // settlement would be worse than none at all.
      const db = seed({
        units: [
          { id: 'u1', label: 'Top 1', usable_area_m2: 60 },
          { id: 'u2', label: 'Top 2', usable_area_m2: null },
        ],
      })
      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(false)
      expect(allocations).toEqual([])
      expect(db._tables.settlement_unit_allocations).toEqual([])
    })()
  })
})

describe('persistAllocationRun - consumption basis', () => {
  // THE REPLACED-METER DEFECT (review: CRITICAL). buildUnitConsumption used to call
  // listMeters({ isActive: true }) — filtering a PAST period by a POINT-IN-TIME flag.
  // Replacing a meter mid-period marks the old one inactive, so its readings vanished.
  // The unit still had the replacement, so no MISSING_READING diagnostic fired and the
  // run was NOT blocked: that unit's consumption was silently understated and every
  // other unit overpaid to cover the position's fixed total. It conserved to the cent.
  const CONSUMPTION_RULE = {
    category: null,
    basis: 'CONSUMPTION',
    owner_deduction_pct: 0,
    consumption_split_pct: null,
    base_split_basis: null,
    heat_split_min_pct: null,
    heat_split_max_pct: null,
  }

  it('counts a DEACTIVATED meter’s readings for a past period', () => {
    return (async () => {
      // u1's meter covered the whole period and was decommissioned afterwards, so it
      // is inactive TODAY while having been the unit's real meter THEN. The old
      // `isActive: true` filter dropped it: u1 would have had no consumption entry at
      // all here. is_active is a point-in-time flag; a settlement is historical.
      const db = seed({
        positions: [{ category: 'WATER_SEWER', amount: 1000 }],
        rules: [CONSUMPTION_RULE],
        meters: [
          { id: 'm-old', unit_id: 'u1', kind: 'COLD_WATER', is_active: false },
          { id: 'm-u2', unit_id: 'u2', kind: 'COLD_WATER', is_active: true },
        ],
        readings: [
          { meter_id: 'm-old', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-old', reading_date: '2026-12-31', value: 150 },
          { meter_id: 'm-u2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-u2', reading_date: '2026-12-31', value: 150 },
        ],
      })

      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(true)
      const byUnit = Object.fromEntries(allocations.map((a) => [a.unit_id, Number(a.amount)]))
      // Equal consumption -> equal bills. Without the fix this run would not have
      // produced a bill for u1 at all.
      expect(byUnit.u1).toBeCloseTo(500, 6)
      expect(byUnit.u2).toBeCloseTo(500, 6)
    })()
  })

  it('sums MULTIPLE meters on one unit rather than picking one', () => {
    return (async () => {
      // Sub-meters (or an old + replacement pair) on the same unit are additive.
      const db = seed({
        positions: [{ category: 'WATER_SEWER', amount: 1000 }],
        rules: [CONSUMPTION_RULE],
        meters: [
          { id: 'm-a', unit_id: 'u1', kind: 'COLD_WATER', is_active: true },
          { id: 'm-b', unit_id: 'u1', kind: 'COLD_WATER', is_active: false },
          { id: 'm-u2', unit_id: 'u2', kind: 'COLD_WATER', is_active: true },
        ],
        readings: [
          { meter_id: 'm-a', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-a', reading_date: '2026-12-31', value: 100 },
          { meter_id: 'm-b', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-b', reading_date: '2026-12-31', value: 50 },
          { meter_id: 'm-u2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-u2', reading_date: '2026-12-31', value: 150 },
        ],
      })
      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(true)
      const byUnit = Object.fromEntries(allocations.map((a) => [a.unit_id, Number(a.amount)]))
      expect(byUnit.u1).toBeCloseTo(500, 6) // 100 + 50 == u2's 150
      expect(byUnit.u2).toBeCloseTo(500, 6)
    })()
  })

  it('BLOCKS a meter installed mid-period (known gap — see the note below)', () => {
    return (async () => {
      // KNOWN LIMITATION, pinned deliberately so a future change is a conscious one.
      // computeMeterConsumption requires a baseline reading dated <= periodStart, so a
      // meter INSTALLED during the period has none and the run blocks with
      // METER_MISSING_BASELINE_READING. Blocking is the safe default — the alternative
      // is inferring a baseline, and the data cannot currently distinguish "installed
      // mid-period, counter started at zero" from "existed all along but nobody read it
      // until July", which would silently undercount that unit and overcharge everyone
      // else. `meters.installed_at`/`removed_at` EXIST (migration 0032) but the
      // consumption math does not consult them yet — that is the fix, and it is a
      // product/legal decision about how a mid-period replacement is billed.
      const db = seed({
        positions: [{ category: 'WATER_SEWER', amount: 1000 }],
        rules: [CONSUMPTION_RULE],
        meters: [
          { id: 'm-new', unit_id: 'u1', kind: 'COLD_WATER', is_active: true },
          { id: 'm-u2', unit_id: 'u2', kind: 'COLD_WATER', is_active: true },
        ],
        readings: [
          // installed in July: its first reading is after periodStart.
          { meter_id: 'm-new', reading_date: '2026-07-01', value: 0 },
          { meter_id: 'm-new', reading_date: '2026-12-31', value: 50 },
          { meter_id: 'm-u2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm-u2', reading_date: '2026-12-31', value: 150 },
        ],
      })
      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(false)
      expect(result.diagnostics.some((d) => d.code === 'UNIT_MISSING_CONSUMPTION_READING')).toBe(true)
      expect(allocations).toEqual([]) // never half-bills
    })()
  })

  it('persists CONSUMPTION as the basis value for a consumption-basis position', () => {
    return (async () => {
      const db = seed({
        positions: [{ category: 'WATER_SEWER', amount: 1000 }],
        rules: [
          {
            category: null,
            basis: 'CONSUMPTION',
            owner_deduction_pct: 0,
            consumption_split_pct: null,
            base_split_basis: null,
            heat_split_min_pct: null,
            heat_split_max_pct: null,
          },
        ],
        meters: [
          { id: 'm1', unit_id: 'u1', kind: 'COLD_WATER', is_active: true },
          { id: 'm2', unit_id: 'u2', kind: 'COLD_WATER', is_active: true },
        ],
        readings: [
          { meter_id: 'm1', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm1', reading_date: '2026-12-31', value: 30 },
          { meter_id: 'm2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'm2', reading_date: '2026-12-31', value: 70 },
        ],
      })
      const { allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      const u1 = allocations.find((a) => a.unit_id === 'u1')!
      // The basis value is CONSUMPTION (30 of 100 units), NOT the unit's 60 m2 area —
      // persisting area here was a real bug fixed during U-B's review.
      expect(Number(u1.unit_basis_value)).toBeCloseTo(30, 6)
      expect(Number(u1.total_basis_value)).toBeCloseTo(100, 6)
      expect(Number(u1.amount)).toBeCloseTo(300, 6)
    })()
  })
})

describe('persistAllocationRun - HeizKG heat split', () => {
  // THE DISCLOSURE DEFECT (review: HIGH). A heat-split row bills the COMBINED
  // consumption leg + area leg, but unit_basis_value/total_basis_value used to be
  // taken from the CONSUMPTION LEG ONLY. The DB's generated share_pct
  // (unit_basis_value / total_basis_value * 100) therefore disagreed with the amount
  // actually charged — a statement reading "your share: 80%" beside a number that is
  // 60% of the allocatable total. A Betriebskostenabrechnung has to be nachvollziehbar.
  it('persists a share_pct that reconciles with the amount billed', () => {
    return (async () => {
      const db = seed({
        // u1 has 60% of the AREA but 80% of the CONSUMPTION, so the two bases
        // disagree sharply — exactly when the defect showed up.
        positions: [{ category: 'HEATING', amount: 1000 }],
        rules: [HEAT_RULE],
        meters: [
          { id: 'h1', unit_id: 'u1', kind: 'HEAT', is_active: true },
          { id: 'h2', unit_id: 'u2', kind: 'HEAT', is_active: true },
        ],
        readings: [
          { meter_id: 'h1', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'h1', reading_date: '2026-12-31', value: 80 },
          { meter_id: 'h2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'h2', reading_date: '2026-12-31', value: 20 },
        ],
      })

      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(true)
      expect(allocations).toHaveLength(2)

      for (const a of allocations) {
        // share_pct is a DB-generated column, so recompute it exactly as the DB would.
        const sharePct = (Number(a.unit_basis_value) / Number(a.total_basis_value)) * 100
        const impliedAmount = (sharePct / 100) * Number(a.allocatable_amount)
        expect(impliedAmount, `unit ${a.unit_id}: share_pct must explain the amount`).toBeCloseTo(
          Number(a.amount),
          6,
        )
      }

      // And the split is genuinely two-legged: u1 pays more than its 60% area share
      // (it burned 80% of the heat) but less than a pure-consumption 80%.
      const byUnit = Object.fromEntries(allocations.map((a) => [a.unit_id, Number(a.amount)]))
      expect(byUnit.u1).toBeGreaterThan(600)
      expect(byUnit.u1).toBeLessThan(800)
      expect(byUnit.u1 + byUnit.u2).toBeCloseTo(1000, 6)
    })()
  })

  it('still reconciles to the cent on an amount that divides badly', () => {
    return (async () => {
      const db = seed({
        positions: [{ category: 'HEATING', amount: 1000.03 }],
        rules: [HEAT_RULE],
        meters: [
          { id: 'h1', unit_id: 'u1', kind: 'HEAT', is_active: true },
          { id: 'h2', unit_id: 'u2', kind: 'HEAT', is_active: true },
        ],
        readings: [
          { meter_id: 'h1', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'h1', reading_date: '2026-12-31', value: 33 },
          { meter_id: 'h2', reading_date: '2026-01-01', value: 0 },
          { meter_id: 'h2', reading_date: '2026-12-31', value: 67 },
        ],
      })
      const { result, allocations } = await persistAllocationRun(db, WS, PERIOD, USER)
      expect(result.ok).toBe(true)
      const sum = allocations.reduce((s, a) => s + Number(a.amount), 0)
      expect(sum).toBeCloseTo(result.allocatableTotalCents / 100, 6)
    })()
  })
})
