import { describe, it, expect } from 'vitest'
import {
  apportionByWeight,
  allocateBetriebskosten,
  AUSTRIA_HEIZKG_MIN_PERMILLE,
  AUSTRIA_HEIZKG_MAX_PERMILLE,
  type AllocationInput,
  type CostPositionInput,
  type HeatSplitConfig,
} from '@/lib/betriebskosten/allocate'
import { BETRIEBSKOSTEN_CATALOG } from '@/lib/betriebskosten/catalog'

// Money math. Every test here exists because getting it wrong bills a real tenant the
// wrong amount, so the emphasis is on INVARIANTS (shares always sum to the total, owner
// + allocatable always equals gross) and on FAIL-CLOSED behaviour (an incomplete area
// key blocks the whole run rather than quietly billing on a partial denominator).

const pos = (over: Partial<CostPositionInput> = {}): CostPositionInput => ({
  id: 'p1',
  category: 'WATER_SEWER',
  grossAmountCents: 100_000,
  ...over,
})

const input = (over: Partial<AllocationInput> = {}): AllocationInput => ({
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  units: [
    { unitId: 'u1', label: 'Top 1', usableAreaM2: 50 },
    { unitId: 'u2', label: 'Top 2', usableAreaM2: 50 },
  ],
  positions: [pos()],
  ...over,
})

describe('apportionByWeight - largest-remainder invariant', () => {
  it('returns [] for no weights and for a zero/negative total weight', () => {
    expect(apportionByWeight(1000, [])).toEqual([])
    expect(apportionByWeight(1000, [{ key: 'a', weight: 0 }])).toEqual([])
    expect(apportionByWeight(1000, [{ key: 'a', weight: -5 }])).toEqual([])
  })

  it('gives every key zero (never NaN) when there is nothing to distribute', () => {
    const out = apportionByWeight(0, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 3 },
    ])
    expect(out.map((r) => r.cents)).toEqual([0, 0])
    expect(out.every((r) => Number.isSafeInteger(r.cents))).toBe(true)
  })

  it('splits an exactly-divisible total evenly with no rounding bonus', () => {
    const out = apportionByWeight(300, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ])
    expect(out.map((r) => r.cents)).toEqual([100, 100, 100])
    expect(out.every((r) => r.bonus === 0)).toBe(true)
  })

  it('distributes an indivisible remainder without losing or inventing a cent', () => {
    const out = apportionByWeight(100, [
      { key: 'a', weight: 1 },
      { key: 'b', weight: 1 },
      { key: 'c', weight: 1 },
    ])
    // 100/3 -> bases 33,33,33 = 99; exactly ONE cent left to hand out.
    expect(out.reduce((s, r) => s + r.cents, 0)).toBe(100)
    expect(out.filter((r) => r.bonus === 1)).toHaveLength(1)
  })

  it('NEVER loses or invents a cent across a spread of awkward splits', () => {
    // The whole point of largest-remainder over independent rounding: independently
    // rounding N shares can drift by up to N/2 cents.
    const totals = [1, 7, 99, 100, 101, 1_234, 99_999, 1_000_001, 987_654_321]
    const weightSets = [
      [1, 1, 1],
      [1, 2, 3],
      [7, 11, 13, 17],
      [1, 1, 1, 1, 1, 1, 1],
      [9_999, 1],
      [3_333, 3_333, 3_334],
    ]
    for (const total of totals) {
      for (const ws of weightSets) {
        const out = apportionByWeight(
          total,
          ws.map((w, i) => ({ key: `k${i}`, weight: w })),
        )
        expect(out.reduce((s, r) => s + r.cents, 0)).toBe(total)
        expect(out.every((r) => r.cents >= 0 && Number.isSafeInteger(r.cents))).toBe(true)
      }
    }
  })

  it('is deterministic - identical input yields identical output', () => {
    const ws = [
      { key: 'a', weight: 5231 },
      { key: 'b', weight: 1777 },
      { key: 'c', weight: 993 },
    ]
    expect(apportionByWeight(123_457, ws)).toEqual(apportionByWeight(123_457, ws))
  })
})

describe('allocateBetriebskosten - area allocation', () => {
  it('splits by usable area and reconciles to the cent', () => {
    const r = allocateBetriebskosten(input())
    expect(r.ok).toBe(true)
    expect(r.units.map((u) => u.totalCents)).toEqual([50_000, 50_000])
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  it('weights unequal areas proportionally', () => {
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 60 },
          { unitId: 'u2', label: 'B', usableAreaM2: 40 },
        ],
      }),
    )
    expect(r.units.map((u) => u.totalCents)).toEqual([60_000, 40_000])
  })

  it('handles fractional square metres via the square-decimetre key', () => {
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 62.55 },
          { unitId: 'u2', label: 'B', usableAreaM2: 37.45 },
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  // --- fail-closed data quality -------------------------------------------------
  it('BLOCKS the whole run when any unit has an unknown (null) area', () => {
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 50 },
          { unitId: 'u2', label: 'B', usableAreaM2: null },
        ],
      }),
    )
    // The critical one: a null area must NEVER be silently read as 0 - that would
    // quietly re-distribute an absent unit's share onto everyone else's bill.
    expect(r.ok).toBe(false)
    expect(r.units).toEqual([])
    expect(r.diagnostics).toContainEqual({
      code: 'UNIT_MISSING_USABLE_AREA',
      blocking: true,
      unitId: 'u2',
      label: 'B',
    })
    expect(r.unallocatableUnits).toContainEqual({
      unitId: 'u2',
      label: 'B',
      reason: 'MISSING_USABLE_AREA',
    })
  })

  it('BLOCKS on a non-positive or non-finite area', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = allocateBetriebskosten(
        input({
          units: [
            { unitId: 'u1', label: 'A', usableAreaM2: 50 },
            { unitId: 'u2', label: 'B', usableAreaM2: bad },
          ],
        }),
      )
      expect(r.ok).toBe(false)
      expect(r.diagnostics.some((d) => d.code === 'UNIT_INVALID_USABLE_AREA')).toBe(true)
    }
  })

  it('BLOCKS with no denominator instead of dividing by zero', () => {
    const r = allocateBetriebskosten(input({ units: [] }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'NO_ALLOCATABLE_AREA', blocking: true })
    expect(r.units).toEqual([])
    expect(Number.isNaN(r.totalAreaDm2)).toBe(false)
  })

  it('BLOCKS on duplicate unit or position ids', () => {
    const dupUnit = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 50 },
          { unitId: 'u1', label: 'A again', usableAreaM2: 50 },
        ],
      }),
    )
    expect(dupUnit.ok).toBe(false)
    expect(dupUnit.diagnostics.some((d) => d.code === 'DUPLICATE_UNIT')).toBe(true)

    const dupPos = allocateBetriebskosten(input({ positions: [pos(), pos()] }))
    expect(dupPos.ok).toBe(false)
    expect(dupPos.diagnostics.some((d) => d.code === 'DUPLICATE_POSITION')).toBe(true)
  })

  it('BLOCKS when a position scopes to a unit that is not in the run', () => {
    const r = allocateBetriebskosten(
      input({ positions: [pos({ participatingUnitIds: ['u1', 'ghost'] })] }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'UNKNOWN_PARTICIPATING_UNIT',
      blocking: true,
      positionId: 'p1',
      unitId: 'ghost',
    })
  })

  // --- owner share + scoping ----------------------------------------------------
  it('withholds the owner share exactly - owner + allocatable === gross', () => {
    const r = allocateBetriebskosten(
      // A 12.5% owner share on an amount that does not divide evenly.
      input({ positions: [pos({ grossAmountCents: 100_003, ownerSharePermille: 125 })] }),
    )
    const p = r.positions[0]
    expect(p.ownerAmountCents + p.allocatableAmountCents).toBe(p.grossAmountCents)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(p.allocatableAmountCents)
  })

  it('applies defaultOwnerSharePermille only where a position omits its own', () => {
    const r = allocateBetriebskosten(
      input({
        defaultOwnerSharePermille: 200,
        positions: [
          pos({ id: 'a' }),
          pos({ id: 'b', category: 'ELEVATOR', ownerSharePermille: 0 }),
        ],
      }),
    )
    expect(r.positions.find((p) => p.positionId === 'a')?.ownerSharePermille).toBe(200)
    expect(r.positions.find((p) => p.positionId === 'b')?.ownerSharePermille).toBe(0)
  })

  it('flags a fully owner-borne position without blocking the run', () => {
    const r = allocateBetriebskosten(input({ positions: [pos({ ownerSharePermille: 1000 })] }))
    expect(r.ok).toBe(true)
    expect(r.positions[0].allocatableAmountCents).toBe(0)
    expect(r.diagnostics).toContainEqual({
      code: 'POSITION_FULLY_OWNER_BORNE',
      blocking: false,
      positionId: 'p1',
    })
  })

  it('flags a zero-amount position without blocking the run', () => {
    const r = allocateBetriebskosten(input({ positions: [pos({ grossAmountCents: 0 })] }))
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toContainEqual({
      code: 'POSITION_ZERO_AMOUNT',
      blocking: false,
      positionId: 'p1',
    })
  })

  it('narrows the denominator to the participating units (the scope seam)', () => {
    // A lift cost billed only across the units with lift access.
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 50 },
          { unitId: 'u2', label: 'B', usableAreaM2: 50 },
          { unitId: 'u3', label: 'C (no lift)', usableAreaM2: 100 },
        ],
        positions: [pos({ id: 'lift', category: 'ELEVATOR', participatingUnitIds: ['u1', 'u2'] })],
      }),
    )
    expect(r.ok).toBe(true)
    const byUnit = Object.fromEntries(r.units.map((u) => [u.unitId, u.totalCents]))
    expect(byUnit.u1).toBe(50_000)
    expect(byUnit.u2).toBe(50_000)
    expect(byUnit.u3).toBe(0) // excluded from THIS position's denominator
    expect(r.positions[0].denominatorAreaDm2).toBe(10_000) // 100 m2 in dm2, not 200
  })

  // --- scope-seam defects caught by adversarial review (both were invisible to the
  // conservation tests above, because total money in still equalled total money out —
  // it was distributed to the WRONG units, or to none at all) ---------------------
  it('BLOCKS a duplicated participating unit instead of double-weighting it', () => {
    // ['u1','u1','u2'] built one weight row PER ENTRY, so u1 was billed 75% of the
    // position instead of its fair 60% and u2 only 25% instead of 40% — a real
    // overcharge and a matching undercharge, with ok:true and no diagnostic. The
    // position still conserved to the cent, which is exactly why it slipped past the
    // invariant tests. Blocking matches how a duplicate in `units` is already treated.
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 60 },
          { unitId: 'u2', label: 'B', usableAreaM2: 40 },
        ],
        positions: [pos({ participatingUnitIds: ['u1', 'u1', 'u2'] })],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'DUPLICATE_PARTICIPATING_UNIT',
      blocking: true,
      positionId: 'p1',
      unitId: 'u1',
    })
    expect(r.units).toEqual([])
  })

  it('BLOCKS an empty participating-unit list instead of vanishing the money', () => {
    // `participatingUnitIds: []` produced no weights, so the position's cost reached
    // nobody's bill — yet it was still added to allocatableTotalCents, silently
    // breaking sum(units) === allocatableTotal, the module's core invariant.
    const r = allocateBetriebskosten(input({ positions: [pos({ participatingUnitIds: [] })] }))
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'EMPTY_PARTICIPATING_UNITS',
      blocking: true,
      positionId: 'p1',
    })
  })

  it('keeps sum(units) === allocatableTotal even with a scoped position present', () => {
    // The invariant defect #2 broke, asserted directly against a scoped run.
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 50 },
          { unitId: 'u2', label: 'B', usableAreaM2: 50 },
          { unitId: 'u3', label: 'C', usableAreaM2: 100 },
        ],
        positions: [
          pos({ id: 'all', grossAmountCents: 20_000 }),
          pos({ id: 'lift', category: 'ELEVATOR', grossAmountCents: 9_999, participatingUnitIds: ['u1', 'u2'] }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  // --- rollups + determinism ----------------------------------------------------
  it('per-category rollups sum to each unit total, across many positions', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({ id: 'a', category: 'WATER_SEWER', grossAmountCents: 33_333 }),
          pos({ id: 'b', category: 'COMMON_ELECTRICITY', grossAmountCents: 12_347 }),
          pos({ id: 'c', category: 'CLEANING', grossAmountCents: 7 }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    for (const u of r.units) {
      expect(u.byCategory.reduce((s, c) => s + c.cents, 0)).toBe(u.totalCents)
    }
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  it('is deterministic and carries the caller-supplied period (no hidden clock)', () => {
    const i = input()
    const a = allocateBetriebskosten(i)
    const b = allocateBetriebskosten(i)
    expect(a).toEqual(b)
    expect(a.periodStart).toBe('2026-01-01')
    expect(a.periodEnd).toBe('2026-12-31')
  })

  // --- contract violations THROW (caller bugs, not data quality) -----------------
  it('throws on a malformed period, bad cents, or out-of-range per-mille', () => {
    expect(() => allocateBetriebskosten(input({ periodStart: '01.01.2026' }))).toThrow()
    expect(() =>
      allocateBetriebskosten(input({ positions: [pos({ grossAmountCents: -1 })] })),
    ).toThrow()
    expect(() =>
      allocateBetriebskosten(input({ positions: [pos({ grossAmountCents: 10.5 })] })),
    ).toThrow()
    expect(() =>
      allocateBetriebskosten(input({ positions: [pos({ ownerSharePermille: 1001 })] })),
    ).toThrow()
  })
})

// --- U-B (migration 0032): CONSUMPTION basis + HeizKG heat split ------------
// Same emphasis as the area suite above: INVARIANTS (a consumption position's
// shares sum to its allocatable total; a heat split's two legs sum to the
// SAME total) and FAIL-CLOSED behaviour (a missing/negative/invalid reading
// blocks the whole run rather than quietly billing on a partial denominator —
// see the module header's "never silently treated as zero" reasoning).

const heatSplit = (over: Partial<HeatSplitConfig> = {}): HeatSplitConfig => ({
  consumptionSplitPermille: 600, // 60% — inside the default Austrian 55-75% bound
  consumption: [
    { unitId: 'u1', consumptionUnits: 30 },
    { unitId: 'u2', consumptionUnits: 70 },
  ],
  ...over,
})

describe('allocateBetriebskosten - plain CONSUMPTION basis', () => {
  it('splits by measured consumption and reconciles to the cent', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 40 },
              { unitId: 'u2', consumptionUnits: 60 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.map((u) => u.totalCents)).toEqual([40_000, 60_000])
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
    expect(r.positions[0].basis).toBe('CONSUMPTION')
    expect(r.positions[0].denominatorAreaDm2).toBe(0)
    expect(r.positions[0].denominatorConsumptionMilliUnits).toBe(100_000) // (40+60) x 1000
  })

  it('handles fractional consumption via the milli-unit key', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 12.345 },
              { unitId: 'u2', consumptionUnits: 7.655 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  it('a zero-consumption unit legitimately gets a zero share, no diagnostic', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 0 },
              { unitId: 'u2', consumptionUnits: 100 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.map((u) => u.totalCents)).toEqual([0, 100_000])
  })

  // --- fail-closed data quality -------------------------------------------
  it('BLOCKS on a missing consumption entry for a participating unit', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [pos({ basis: 'CONSUMPTION', consumption: [{ unitId: 'u1', consumptionUnits: 40 }] })],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'UNIT_MISSING_CONSUMPTION_READING',
      blocking: true,
      positionId: 'p1',
      unitId: 'u2',
    })
    expect(r.units).toEqual([])
  })

  it('BLOCKS on an explicit null consumption reading (never silently 0)', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 40 },
              { unitId: 'u2', consumptionUnits: null },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'UNIT_MISSING_CONSUMPTION_READING',
      blocking: true,
      positionId: 'p1',
      unitId: 'u2',
    })
  })

  it('BLOCKS on a negative consumption reading (meter rollover or replacement)', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 40 },
              { unitId: 'u2', consumptionUnits: -5 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'UNIT_NEGATIVE_CONSUMPTION_READING',
      blocking: true,
      positionId: 'p1',
      unitId: 'u2',
      value: -5,
    })
  })

  it('BLOCKS on a non-finite consumption reading', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = allocateBetriebskosten(
        input({
          positions: [
            pos({
              basis: 'CONSUMPTION',
              consumption: [
                { unitId: 'u1', consumptionUnits: 40 },
                { unitId: 'u2', consumptionUnits: bad },
              ],
            }),
          ],
        }),
      )
      expect(r.ok).toBe(false)
      expect(r.diagnostics.some((d) => d.code === 'UNIT_INVALID_CONSUMPTION_READING')).toBe(true)
    }
  })

  it('BLOCKS on a duplicate consumption entry for the same unit', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 40 },
              { unitId: 'u1', consumptionUnits: 41 },
              { unitId: 'u2', consumptionUnits: 60 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({
      code: 'DUPLICATE_CONSUMPTION_ENTRY',
      blocking: true,
      positionId: 'p1',
      unitId: 'u1',
    })
  })

  it('BLOCKS a zero total consumption denominator when there is real money to distribute', () => {
    // Never silently vanish this leg's cost — apportionByWeight's own
    // zero-weight guard would return [], quietly breaking
    // sum(units) === allocatableTotal.
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 0 },
              { unitId: 'u2', consumptionUnits: 0 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'NO_ALLOCATABLE_CONSUMPTION', blocking: true, positionId: 'p1' })
  })

  it('does NOT block a zero total consumption denominator when the position is EUR 0', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            grossAmountCents: 0,
            basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 0 },
              { unitId: 'u2', consumptionUnits: 0 },
            ],
          }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.diagnostics.some((d) => d.code === 'NO_ALLOCATABLE_CONSUMPTION')).toBe(false)
  })
})

describe('allocateBetriebskosten - HeizKG heat split', () => {
  it('conserves to the cent: consumption leg + area leg === allocatable, per unit and in total', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [pos({ id: 'heat', category: 'HEATING', grossAmountCents: 100_003, heatSplit: heatSplit() })],
      }),
    )
    expect(r.ok).toBe(true)
    const p = r.positions[0]
    expect(p.heatSplit).toBeTruthy()
    expect(p.heatSplit!.consumptionLegCents + p.heatSplit!.areaLegCents).toBe(p.allocatableAmountCents)
    expect(p.heatSplit!.consumptionShares.reduce((s, x) => s + x.shareCents, 0)).toBe(p.heatSplit!.consumptionLegCents)
    expect(p.heatSplit!.areaShares.reduce((s, x) => s + x.shareCents, 0)).toBe(p.heatSplit!.areaLegCents)
    expect(p.shares.reduce((s, x) => s + x.shareCents, 0)).toBe(p.allocatableAmountCents)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
  })

  it('a combined share is the exact sum of its two legs, per unit', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [pos({ id: 'heat', category: 'HOT_WATER', grossAmountCents: 77_777, heatSplit: heatSplit() })],
      }),
    )
    const p = r.positions[0]
    for (const combined of p.shares) {
      const c = p.heatSplit!.consumptionShares.find((x) => x.unitId === combined.unitId)?.shareCents ?? 0
      const a = p.heatSplit!.areaShares.find((x) => x.unitId === combined.unitId)?.shareCents ?? 0
      expect(combined.shareCents).toBe(c + a)
    }
  })

  it('defaults the bound to the Austrian HeizKG 55-75% range when omitted', () => {
    const r = allocateBetriebskosten(
      input({ positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit() })] }),
    )
    expect(r.positions[0].heatSplit!.minPermille).toBe(AUSTRIA_HEIZKG_MIN_PERMILLE)
    expect(r.positions[0].heatSplit!.maxPermille).toBe(AUSTRIA_HEIZKG_MAX_PERMILLE)
    expect(AUSTRIA_HEIZKG_MIN_PERMILLE).toBe(550)
    expect(AUSTRIA_HEIZKG_MAX_PERMILLE).toBe(750)
  })

  it('accepts a configured non-Austrian bound (Germany HeizkostenV 50-70%)', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            id: 'heat',
            category: 'HEATING',
            heatSplit: heatSplit({ consumptionSplitPermille: 600, minPermille: 500, maxPermille: 700 }),
          }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.positions[0].heatSplit!.minPermille).toBe(500)
    expect(r.positions[0].heatSplit!.maxPermille).toBe(700)
  })

  // --- the 55-75% (or configured) bound is a CONTRACT, not a data-quality issue
  it('THROWS when consumptionSplitPermille is outside its own bound', () => {
    // Below the Austrian default (55%).
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit({ consumptionSplitPermille: 400 }) })],
        }),
      ),
    ).toThrow()
    // Above the Austrian default (75%).
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit({ consumptionSplitPermille: 900 }) })],
        }),
      ),
    ).toThrow()
    // Exactly at the boundary is ACCEPTED (inclusive range).
    for (const boundary of [AUSTRIA_HEIZKG_MIN_PERMILLE, AUSTRIA_HEIZKG_MAX_PERMILLE]) {
      const r = allocateBetriebskosten(
        input({
          positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit({ consumptionSplitPermille: boundary }) })],
        }),
      )
      expect(r.ok).toBe(true)
    }
    // Inside Germany's 50-70% but a configured Austrian-default run would
    // reject 600 if it were, say, 400 — the point is the bound applies to
    // whichever range this call configured, not a hard-coded literal.
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [
            pos({
              id: 'heat',
              category: 'HEATING',
              heatSplit: heatSplit({ consumptionSplitPermille: 480, minPermille: 500, maxPermille: 700 }),
            }),
          ],
        }),
      ),
    ).toThrow()
  })

  it('THROWS when minPermille exceeds maxPermille', () => {
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [
            pos({
              id: 'heat',
              category: 'HEATING',
              heatSplit: heatSplit({ consumptionSplitPermille: 600, minPermille: 700, maxPermille: 500 }),
            }),
          ],
        }),
      ),
    ).toThrow()
  })

  it('THROWS on a non-integer or out-of-[0,1000] consumptionSplitPermille', () => {
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit({ consumptionSplitPermille: 62.5 }) })],
        }),
      ),
    ).toThrow()
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit({ consumptionSplitPermille: 1500 }) })],
        }),
      ),
    ).toThrow()
  })

  it('THROWS when baseBasis is anything other than USABLE_AREA', () => {
    expect(() =>
      allocateBetriebskosten(
        input({
          positions: [
            pos({
              id: 'heat',
              category: 'HEATING',
              // Cast past the TS literal — the runtime guard is what a DB row
              // (which is NOT type-checked) actually relies on.
              heatSplit: heatSplit({ baseBasis: 'PER_UNIT' as unknown as 'USABLE_AREA' }),
            }),
          ],
        }),
      ),
    ).toThrow()
  })

  // --- structural prevention: HEATING/HOT_WATER can NEVER skip the split ---
  it('THROWS when category is HEATING/HOT_WATER and heatSplit is missing', () => {
    expect(() => allocateBetriebskosten(input({ positions: [pos({ id: 'heat', category: 'HEATING' })] }))).toThrow()
    expect(() => allocateBetriebskosten(input({ positions: [pos({ id: 'hw', category: 'HOT_WATER' })] }))).toThrow()
    // Also true when the position tries to sneak in on a plain area/consumption basis.
    expect(() =>
      allocateBetriebskosten(input({ positions: [pos({ id: 'heat', category: 'HEATING', basis: 'USABLE_AREA' })] })),
    ).toThrow()
  })

  it('THROWS when heatSplit is set on a non-heat category', () => {
    expect(() =>
      allocateBetriebskosten(
        input({ positions: [pos({ id: 'p1', category: 'WATER_SEWER', heatSplit: heatSplit() })] }),
      ),
    ).toThrow()
  })

  // --- fail-closed data quality on the consumption leg ---------------------
  it('BLOCKS the whole run on a missing/negative reading in the consumption leg', () => {
    const rMissing = allocateBetriebskosten(
      input({
        positions: [
          pos({
            id: 'heat',
            category: 'HEATING',
            heatSplit: heatSplit({ consumption: [{ unitId: 'u1', consumptionUnits: 30 }] }),
          }),
        ],
      }),
    )
    expect(rMissing.ok).toBe(false)
    expect(rMissing.diagnostics).toContainEqual({
      code: 'UNIT_MISSING_CONSUMPTION_READING',
      blocking: true,
      positionId: 'heat',
      unitId: 'u2',
    })

    const rNegative = allocateBetriebskosten(
      input({
        positions: [
          pos({
            id: 'heat',
            category: 'HEATING',
            heatSplit: heatSplit({
              consumption: [
                { unitId: 'u1', consumptionUnits: 30 },
                { unitId: 'u2', consumptionUnits: -1 },
              ],
            }),
          }),
        ],
      }),
    )
    expect(rNegative.ok).toBe(false)
    expect(rNegative.diagnostics.some((d) => d.code === 'UNIT_NEGATIVE_CONSUMPTION_READING')).toBe(true)
  })

  it('BLOCKS a zero-weight consumption leg when there is real money on that leg', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            id: 'heat',
            category: 'HEATING',
            heatSplit: heatSplit({
              consumption: [
                { unitId: 'u1', consumptionUnits: 0 },
                { unitId: 'u2', consumptionUnits: 0 },
              ],
            }),
          }),
        ],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual({ code: 'NO_ALLOCATABLE_CONSUMPTION', blocking: true, positionId: 'heat' })
  })

  it('still blocks the whole run on a missing/invalid AREA key (the area leg needs it too)', () => {
    const r = allocateBetriebskosten(
      input({
        units: [
          { unitId: 'u1', label: 'A', usableAreaM2: 50 },
          { unitId: 'u2', label: 'B', usableAreaM2: null },
        ],
        positions: [pos({ id: 'heat', category: 'HEATING', heatSplit: heatSplit() })],
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.diagnostics.some((d) => d.code === 'UNIT_MISSING_USABLE_AREA')).toBe(true)
  })

  it('withholds the owner share BEFORE splitting into legs', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({
            id: 'heat',
            category: 'HEATING',
            grossAmountCents: 100_000,
            ownerSharePermille: 200, // 20% owner-borne, 80% allocatable
            heatSplit: heatSplit({ consumptionSplitPermille: 600 }),
          }),
        ],
      }),
    )
    const p = r.positions[0]
    expect(p.ownerAmountCents).toBe(20_000)
    expect(p.allocatableAmountCents).toBe(80_000)
    expect(p.heatSplit!.consumptionLegCents).toBe(48_000) // 60% of 80,000
    expect(p.heatSplit!.areaLegCents).toBe(32_000)
  })

  it('is deterministic - identical input yields identical output', () => {
    const i = input({
      positions: [pos({ id: 'heat', category: 'HEATING', grossAmountCents: 55_557, heatSplit: heatSplit() })],
    })
    expect(allocateBetriebskosten(i)).toEqual(allocateBetriebskosten(i))
  })

  it('mixes USABLE_AREA, CONSUMPTION, and a heat split in one run and still conserves in total', () => {
    const r = allocateBetriebskosten(
      input({
        positions: [
          pos({ id: 'area', category: 'WATER_SEWER', grossAmountCents: 20_000 }),
          pos({
            id: 'cold', category: 'WATER_SEWER', grossAmountCents: 9_999, basis: 'CONSUMPTION',
            consumption: [
              { unitId: 'u1', consumptionUnits: 1 },
              { unitId: 'u2', consumptionUnits: 2 },
            ],
          }),
          pos({ id: 'heat', category: 'HEATING', grossAmountCents: 33_331, heatSplit: heatSplit() }),
        ],
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.units.reduce((s, u) => s + u.totalCents, 0)).toBe(r.allocatableTotalCents)
    expect(r.allocatableTotalCents).toBe(20_000 + 9_999 + 33_331)
  })
})

describe('operating-cost catalog', () => {
  it('has reviewable metadata for every category in the enum', () => {
    const LEGAL_BASES = ['MRG_21_1', 'MRG_21_2', 'MRG_22', 'MRG_23', 'MRG_24', 'HEIZKG']
    const entries = Object.entries(BETRIEBSKOSTEN_CATALOG)
    expect(entries.length).toBeGreaterThan(0)

    for (const [category, meta] of entries) {
      expect(meta, category).toBeTruthy()
      // Both labels present: the DB/enum always carries the ASCII identifier, so a
      // missing label would surface a raw enum key to a tenant on a statement.
      expect(meta.de.length, `${category}.de`).toBeGreaterThan(0)
      expect(meta.en.length, `${category}.en`).toBeGreaterThan(0)
      // Every chargeable category must name the statute it is chargeable under -
      // that citation is the whole compliance claim.
      expect(LEGAL_BASES, `${category}.legalBasis`).toContain(meta.legalBasis)
      expect(typeof meta.defaultBasis, `${category}.defaultBasis`).toBe('string')
    }
  })

  it('marks the categories that carry a consent, cap, or user-scope caveat', () => {
    // These flags exist so the UI can nudge rather than imply full compliance; if they
    // were all false the caveats would silently vanish from the product.
    const all = Object.values(BETRIEBSKOSTEN_CATALOG)
    expect(all.some((m) => m.requiresTenantConsent)).toBe(true)
    expect(all.some((m) => m.statutoryCap !== null)).toBe(true)
    expect(all.some((m) => m.scopedToUsers)).toBe(true)
  })

  it('still admits no OTHER escape-hatch', () => {
    // An 'OTHER' bucket would defeat the compliance point — it is exactly how a
    // non-passable cost would get onto a statement.
    expect(Object.keys(BETRIEBSKOSTEN_CATALOG)).not.toContain('OTHER')
  })

  it('admits HEATING/HOT_WATER (U-B) ONLY under HeizKG with a CONSUMPTION default basis', () => {
    // U-A withheld these two deliberately (only an area basis existed then);
    // U-B unlocks them, but ONLY in the shape the law allows — never area-only.
    for (const key of ['HEATING', 'HOT_WATER'] as const) {
      const meta = BETRIEBSKOSTEN_CATALOG[key]
      expect(meta.legalBasis, key).toBe('HEIZKG')
      expect(meta.defaultBasis, key).toBe('CONSUMPTION')
    }
  })
})
