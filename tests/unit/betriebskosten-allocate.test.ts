import { describe, it, expect } from 'vitest'
import {
  apportionByWeight,
  allocateBetriebskosten,
  type AllocationInput,
  type CostPositionInput,
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

describe('operating-cost catalog', () => {
  it('has reviewable metadata for every category in the enum', () => {
    const LEGAL_BASES = ['MRG_21_1', 'MRG_21_2', 'MRG_22', 'MRG_23', 'MRG_24']
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

  it('admits no escape-hatch or heating category', () => {
    // An 'OTHER' bucket would defeat the compliance point (it is exactly how a
    // non-passable cost gets onto a statement), and heating belongs to the HeizKG with
    // a measured-consumption basis this slice does not implement.
    const keys = Object.keys(BETRIEBSKOSTEN_CATALOG)
    expect(keys).not.toContain('OTHER')
    expect(keys).not.toContain('HEATING')
    expect(keys).not.toContain('HOT_WATER')
  })
})
