// Pure section-17 MRG area-proportional Betriebskosten allocation engine (U-A).
// No Supabase import, no clock, no Math.random — the caller supplies
// periodStart/periodEnd and every unit/cost-position input; this module only
// computes. Same pure-module discipline as src/lib/invoices/recurring.ts and
// src/lib/occupancy/timeline.ts (injected `today`/no hidden clock).
//
// MONEY IS INTEGER CENTS, ALWAYS, INSIDE THIS MODULE. round2-style float money
// (src/lib/invoices/compute.ts) is correct for one total but drifts by up to
// N/2 cents when N shares are rounded independently — the entire point of a
// Betriebskostenabrechnung is a statement that reconciles line-by-line, so this
// module never uses float money.
//
// AREAS ARE INTEGER SQUARE-DECIMETRES (0.01 m2 resolution — finer than any
// Austrian Nutzflaeche is ever stated) inside this module: areaDm2 =
// Math.round(usableAreaM2 * 100). Applied identically to numerator and
// denominator, so the ratio is unaffected; it removes float summation drift
// from the denominator and makes apportionment reproducible bit-for-bit.
//
// See docs/superpowers/plans/2026-07-19-product-deepening.md §4 and the U-A
// "catalog-and-math" design for the full edge-case catalogue this module
// implements (repeated inline below, next to the code that satisfies it).

import type { OperatingCostCategory } from '@/types/domain'

export type IsoDate = string // 'YYYY-MM-DD'

export type CostPositionInput = {
  /** The breakdown key — one entry per settlement_cost_positions CATEGORY
   * rollup (the caller sums individual bills into one position per category
   * before calling this function; see src/lib/data/settlements.ts). */
  id: string
  category: OperatingCostCategory
  /** Gross amount for this position, integer cents, >= 0. */
  grossAmountCents: number
  /** Owner/common portion withheld before allocation, in PER-MILLE (0..1000) —
   * per-mille, not percent, so a 12.5% owner share is exactly representable as
   * an integer (125). Defaults to `defaultOwnerSharePermille` (itself defaults
   * to 0) when omitted. */
  ownerSharePermille?: number
  /** section-24 scope seam: when present, ONLY these unit ids form the
   * denominator for THIS position (e.g. a lift cost over the units that have
   * lift access). undefined = all units of the property. */
  participatingUnitIds?: string[]
}

export type AllocationUnitInput = {
  unitId: string
  /** Display only, carried into the output. */
  label: string
  /** Nutzflaeche. null = UNKNOWN (not yet surveyed), never zero — see
   * UNIT_MISSING_USABLE_AREA below for why an unknown area blocks the WHOLE
   * run rather than merely excluding that unit. */
  usableAreaM2: number | null
}

export type AllocationInput = {
  /** Caller-supplied — NO clock inside this module. */
  periodStart: IsoDate
  periodEnd: IsoDate
  /** MUST be exactly the units of ONE property — this function is
   * property-agnostic (it never sees property_id) and cannot detect a caller
   * that accidentally mixes units from two properties. Enforce at the
   * caller. */
  units: AllocationUnitInput[]
  positions: CostPositionInput[]
  /** Applied to any position that omits its own `ownerSharePermille`. */
  defaultOwnerSharePermille?: number
}

export type UnitShare = {
  unitId: string
  areaDm2: number
  shareCents: number
  /** Audit trail: did the largest-remainder rule add a cent here. */
  roundingBonusCent: 0 | 1
}

export type PositionBreakdown = {
  positionId: string
  category: OperatingCostCategory
  basis: 'USABLE_AREA'
  grossAmountCents: number
  ownerSharePermille: number
  /** Withheld from tenants. */
  ownerAmountCents: number
  /** gross - owner, the EXACT complement (no third rounding) — the invariant
   * `ownerAmountCents + allocatableAmountCents === grossAmountCents` always
   * holds, by construction. */
  allocatableAmountCents: number
  /** This position's denominator (differs from totalAreaDm2 when
   * participatingUnitIds scopes it down). */
  denominatorAreaDm2: number
  /** [] when the overall run is blocked (`ok: false`) or when every unit
   * either has zero allocatable amount is skipped. */
  shares: UnitShare[]
}

export type UnitAllocation = {
  unitId: string
  label: string
  usableAreaM2: number
  /** The key, x1000, rounded — DISPLAY/AUDIT ONLY, never used in money math. */
  areaPermille: number
  totalCents: number
  byCategory: { category: OperatingCostCategory; cents: number }[]
}

export type AllocationDiagnostic =
  | { code: 'UNIT_MISSING_USABLE_AREA'; blocking: true; unitId: string; label: string }
  | { code: 'UNIT_INVALID_USABLE_AREA'; blocking: true; unitId: string; label: string; value: number }
  | { code: 'NO_ALLOCATABLE_AREA'; blocking: true }
  | { code: 'DUPLICATE_UNIT'; blocking: true; unitId: string }
  | { code: 'DUPLICATE_POSITION'; blocking: true; positionId: string }
  | { code: 'UNKNOWN_PARTICIPATING_UNIT'; blocking: true; positionId: string; unitId: string }
  // A unit repeated in participatingUnitIds used to build one weight row PER ENTRY,
  // so the repeated unit was billed a multiple of its fair share and every other
  // participant was undercharged to match. The position still conserved to the cent,
  // so no conservation check could catch it. Blocking mirrors DUPLICATE_UNIT above.
  | { code: 'DUPLICATE_PARTICIPATING_UNIT'; blocking: true; positionId: string; unitId: string }
  // participatingUnitIds: [] (as opposed to undefined) yields no weights at all, so
  // the position's cost reached nobody — while still counting toward
  // allocatableTotalCents, silently breaking sum(units) === allocatableTotal. An
  // empty participant list is never a meaningful instruction, so it blocks rather
  // than quietly dropping money, consistent with NO_ALLOCATABLE_AREA.
  | { code: 'EMPTY_PARTICIPATING_UNITS'; blocking: true; positionId: string }
  | { code: 'POSITION_FULLY_OWNER_BORNE'; blocking: false; positionId: string }
  | { code: 'POSITION_ZERO_AMOUNT'; blocking: false; positionId: string }

export type AllocationResult = {
  periodStart: IsoDate
  periodEnd: IsoDate
  /** Sum over allocatable (valid-area) units. */
  totalAreaDm2: number
  grossTotalCents: number
  ownerTotalCents: number
  allocatableTotalCents: number
  /** [] when !ok. */
  units: UnitAllocation[]
  unallocatableUnits: { unitId: string; label: string; reason: 'MISSING_USABLE_AREA' | 'INVALID_USABLE_AREA' }[]
  /** shares: [] on every entry when !ok. */
  positions: PositionBreakdown[]
  diagnostics: AllocationDiagnostic[]
  ok: boolean
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertIsoDate(name: string, value: string): void {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
    throw new Error(`allocateBetriebskosten: ${name} must be 'YYYY-MM-DD', got '${value}'`)
  }
}

function assertCents(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`allocateBetriebskosten: ${label} must be a non-negative safe integer (cents), got ${value}`)
  }
}

function assertPermille(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new Error(`allocateBetriebskosten: ${label} must be an integer in [0, 1000] (per-mille), got ${value}`)
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

/**
 * Half-up rounding of `cents * permille / 1000`, done entirely in BigInt so a
 * large gross amount never approaches float precision limits. Returns a
 * non-negative integer <= cents (permille is clamped to [0, 1000] by the
 * caller's contract check before this is ever invoked).
 */
function roundPermille(cents: number, permille: number): number {
  return Number((BigInt(cents) * BigInt(permille) + BigInt(500)) / BigInt(1000))
}

/**
 * Largest-remainder (Hare/Niemeyer) apportionment of an integer cent total
 * across integer weights. INVARIANT: `sum(result.cents) === totalCents`,
 * exactly, always (when weights is non-empty and its total weight > 0).
 *
 * Two distinct "nothing to distribute" cases, handled differently on purpose:
 *   - weights is empty, OR every weight is <= 0 (no valid denominator at all,
 *     the "zero-area guard") -> returns [] — there is no meaningful per-key
 *     split to report.
 *   - the WEIGHTS are valid but totalCents is exactly 0 (e.g. a position that
 *     is 100% owner-borne) -> returns one zero-cent row PER key, since every
 *     key legitimately participates in a statement that shows "€0 for you".
 *
 * Deterministic tie-break: highest remainder wins; ties broken by larger
 * weight; remaining ties broken by ascending BYTE-ORDER key (not
 * localeCompare — locale-independent and total, matching the `id` tie-break in
 * src/lib/occupancy/timeline.ts / rent-roll.ts). The sort operates on a COPY,
 * so the returned array preserves the INPUT order of `weights`.
 */
export function apportionByWeight(
  totalCents: number,
  weights: { key: string; weight: number }[],
): { key: string; cents: number; bonus: 0 | 1 }[] {
  if (weights.length === 0) return []

  const totalWeight = sum(weights.map((w) => w.weight))
  if (totalWeight <= 0) return []

  if (totalCents === 0) {
    return weights.map((w) => ({ key: w.key, cents: 0, bonus: 0 as const }))
  }

  const total = BigInt(totalCents)
  const bigTotalWeight = BigInt(totalWeight)

  type Row = { key: string; weight: number; base: number; remainder: bigint }
  const rows: Row[] = weights.map((w) => {
    const numerator = total * BigInt(w.weight)
    const base = numerator / bigTotalWeight // BigInt floor division (both operands >= 0)
    const remainder = numerator - base * bigTotalWeight
    return { key: w.key, weight: w.weight, base: Number(base), remainder }
  })

  const sumBase = sum(rows.map((r) => r.base))
  // Provably 0 <= leftover < weights.length: sum(floor(total*w_i/W)) loses less
  // than 1 per term versus the exact real-valued sum (which equals `total`
  // since sum(w_i) = W), so the total shortfall across n terms is < n.
  const leftover = totalCents - sumBase

  const order = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1
    if (a.weight !== b.weight) return b.weight - a.weight
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
  })

  const bonusByKey = new Map<string, 0 | 1>()
  for (let i = 0; i < order.length; i++) {
    bonusByKey.set(order[i].key, i < leftover ? 1 : 0)
  }

  return rows.map((r) => {
    const bonus = bonusByKey.get(r.key) ?? 0
    return { key: r.key, cents: r.base + bonus, bonus }
  })
}

/**
 * Allocate one settlement period's cost positions across a property's units
 * per MRG section 17 (Nutzflaeche-proportional), after an optional owner/common
 * deduction per position. See the module header for the money/area unit
 * conventions and src/lib/data/settlements.ts for how DB rows become this
 * function's inputs (and vice versa for its outputs).
 *
 * CONTRACT ERRORS (programmer/caller mistakes, already guarded by a DB check
 * constraint and/or a form boundary upstream of this call) THROW:
 *   - grossAmountCents / ownerSharePermille / defaultOwnerSharePermille out of
 *     range or non-integer.
 *   - periodStart/periodEnd not 'YYYY-MM-DD', or periodEnd < periodStart.
 *
 * DATA-QUALITY problems DEGRADE into `diagnostics` + `ok: false` and NEVER
 * throw, NEVER return NaN — see AllocationDiagnostic for the full catalogue.
 */
export function allocateBetriebskosten(input: AllocationInput): AllocationResult {
  assertIsoDate('periodStart', input.periodStart)
  assertIsoDate('periodEnd', input.periodEnd)
  if (input.periodEnd < input.periodStart) {
    throw new Error(
      `allocateBetriebskosten: periodEnd (${input.periodEnd}) is before periodStart (${input.periodStart})`,
    )
  }

  const defaultOwnerSharePermille = input.defaultOwnerSharePermille ?? 0
  assertPermille('defaultOwnerSharePermille', defaultOwnerSharePermille)

  for (const p of input.positions) {
    assertCents(`position '${p.id}' grossAmountCents`, p.grossAmountCents)
    assertPermille(
      `position '${p.id}' ownerSharePermille`,
      p.ownerSharePermille ?? defaultOwnerSharePermille,
    )
  }

  const diagnostics: AllocationDiagnostic[] = []

  // --- units: duplicates + Nutzflaeche classification ------------------------
  const unitIndex = new Map<string, AllocationUnitInput>()
  const seenUnitIds = new Set<string>()
  for (const u of input.units) {
    if (seenUnitIds.has(u.unitId)) {
      diagnostics.push({ code: 'DUPLICATE_UNIT', blocking: true, unitId: u.unitId })
      continue // keep the FIRST occurrence only — a Map would silently drop one
      // and understate the denominator either way; detecting is the point.
    }
    seenUnitIds.add(u.unitId)
    unitIndex.set(u.unitId, u)
  }

  const unallocatableUnits: AllocationResult['unallocatableUnits'] = []
  const areaDm2ByUnit = new Map<string, number>()
  for (const u of unitIndex.values()) {
    if (u.usableAreaM2 === null) {
      // NULL means "not yet surveyed", NEVER "excluded from the key". Blocking
      // the WHOLE run (not just excluding this unit) is deliberate: section
      // 17's denominator is the property's TOTAL Nutzflaeche, so one unknown
      // unit area makes every OTHER unit's share unknown too — silently
      // excluding it would spread its share across the remaining tenants, who
      // would overpay. That is the exact legal harm this engine exists to
      // prevent (see docs/superpowers/plans/2026-07-19-product-deepening.md §4
      // risk notes).
      diagnostics.push({ code: 'UNIT_MISSING_USABLE_AREA', blocking: true, unitId: u.unitId, label: u.label })
      unallocatableUnits.push({ unitId: u.unitId, label: u.label, reason: 'MISSING_USABLE_AREA' })
      continue
    }
    if (!Number.isFinite(u.usableAreaM2) || u.usableAreaM2 <= 0) {
      // Legacy/bad data pre-dating the DB check constraint — degrade, don't throw.
      diagnostics.push({
        code: 'UNIT_INVALID_USABLE_AREA',
        blocking: true,
        unitId: u.unitId,
        label: u.label,
        value: u.usableAreaM2,
      })
      unallocatableUnits.push({ unitId: u.unitId, label: u.label, reason: 'INVALID_USABLE_AREA' })
      continue
    }
    areaDm2ByUnit.set(u.unitId, Math.round(u.usableAreaM2 * 100))
  }

  const totalAreaDm2 = sum([...areaDm2ByUnit.values()])
  if (totalAreaDm2 <= 0) {
    // Covers: zero units, every unit missing/invalid, AND the genuinely-valid-
    // but-vanishingly-small case (every area rounds to 0 dm2). The division is
    // never reached in any of these — apportionByWeight's own zero-weight
    // guard would also return [], but we block the WHOLE run here rather than
    // silently zeroing one position, for the same reason as the missing-area
    // case above.
    diagnostics.push({ code: 'NO_ALLOCATABLE_AREA', blocking: true })
  }

  // --- positions: duplicates + participating-unit validity + zero/owner-borne
  const positionIndex = new Map<string, CostPositionInput>()
  const seenPositionIds = new Set<string>()
  for (const p of input.positions) {
    if (seenPositionIds.has(p.id)) {
      diagnostics.push({ code: 'DUPLICATE_POSITION', blocking: true, positionId: p.id })
      continue
    }
    seenPositionIds.add(p.id)
    positionIndex.set(p.id, p)
  }

  for (const p of positionIndex.values()) {
    if (p.grossAmountCents === 0) {
      diagnostics.push({ code: 'POSITION_ZERO_AMOUNT', blocking: false, positionId: p.id })
    }
    if (p.participatingUnitIds) {
      if (p.participatingUnitIds.length === 0) {
        // Distinct from `undefined` (= all units). An explicitly empty list would
        // produce no weights, so this position's cost would reach NO ONE while still
        // counting toward allocatableTotalCents — money silently vanishing from the
        // reconciliation. Never a meaningful instruction, so block it.
        diagnostics.push({ code: 'EMPTY_PARTICIPATING_UNITS', blocking: true, positionId: p.id })
      }
      const seenParticipants = new Set<string>()
      for (const uid of p.participatingUnitIds) {
        if (!unitIndex.has(uid)) {
          // A typo'd participant list would otherwise silently shrink the
          // denominator and overcharge the rest — detect, don't ignore.
          diagnostics.push({ code: 'UNKNOWN_PARTICIPATING_UNIT', blocking: true, positionId: p.id, unitId: uid })
        }
        if (seenParticipants.has(uid)) {
          // Weights are built one row per LIST ENTRY, so a repeat would weight that
          // unit twice — overcharging it and undercharging everyone else, while the
          // position still conserved to the cent (invisible to any sum check).
          diagnostics.push({ code: 'DUPLICATE_PARTICIPATING_UNIT', blocking: true, positionId: p.id, unitId: uid })
        }
        seenParticipants.add(uid)
      }
    }
  }

  const ok = diagnostics.every((d) => !d.blocking)

  // --- per-position breakdown (gross/owner/allocatable always computed; the
  // per-unit share split only runs when the overall run is not blocked) ------
  const positions: PositionBreakdown[] = []
  const totalsByUnit = new Map<string, { totalCents: number; byCategory: Map<OperatingCostCategory, number> }>()
  let grossTotalCents = 0
  let ownerTotalCents = 0
  let allocatableTotalCents = 0

  for (const p of positionIndex.values()) {
    const ownerSharePermille = p.ownerSharePermille ?? defaultOwnerSharePermille
    const ownerAmountCents = roundPermille(p.grossAmountCents, ownerSharePermille)
    // EXACT complement — never rounded a second time — so
    // ownerAmountCents + allocatableAmountCents === grossAmountCents always.
    const allocatableAmountCents = p.grossAmountCents - ownerAmountCents

    grossTotalCents += p.grossAmountCents
    ownerTotalCents += ownerAmountCents
    allocatableTotalCents += allocatableAmountCents

    if (allocatableAmountCents === 0 && p.grossAmountCents > 0) {
      diagnostics.push({ code: 'POSITION_FULLY_OWNER_BORNE', blocking: false, positionId: p.id })
    }

    const participantIds = p.participatingUnitIds ?? [...unitIndex.keys()]
    const weights = participantIds
      .filter((id) => areaDm2ByUnit.has(id))
      .map((id) => ({ key: id, weight: areaDm2ByUnit.get(id) as number }))
    const denominatorAreaDm2 = sum(weights.map((w) => w.weight))

    let shares: UnitShare[] = []
    if (ok) {
      const apportioned = apportionByWeight(allocatableAmountCents, weights)
      shares = apportioned.map((a) => ({
        unitId: a.key,
        areaDm2: areaDm2ByUnit.get(a.key) as number,
        shareCents: a.cents,
        roundingBonusCent: a.bonus,
      }))
      for (const s of shares) {
        let entry = totalsByUnit.get(s.unitId)
        if (!entry) {
          entry = { totalCents: 0, byCategory: new Map() }
          totalsByUnit.set(s.unitId, entry)
        }
        entry.totalCents += s.shareCents
        entry.byCategory.set(p.category, (entry.byCategory.get(p.category) ?? 0) + s.shareCents)
      }
    }

    positions.push({
      positionId: p.id,
      category: p.category,
      basis: 'USABLE_AREA',
      grossAmountCents: p.grossAmountCents,
      ownerSharePermille,
      ownerAmountCents,
      allocatableAmountCents,
      denominatorAreaDm2,
      shares,
    })
  }

  // --- per-unit aggregate (vacant/owner-occupied units get a row too — the
  // denominator is EVERY unit of the property; their share falls to the owner,
  // never redistributed. Sorted by label then unitId — display only, never
  // touches money — mirroring the rent-roll.ts localeCompare/id-tie-break split).
  const units: UnitAllocation[] = ok
    ? [...unitIndex.values()]
        .map((u) => {
          const entry = totalsByUnit.get(u.unitId)
          const areaDm2 = areaDm2ByUnit.get(u.unitId) as number
          return {
            unitId: u.unitId,
            label: u.label,
            usableAreaM2: u.usableAreaM2 as number,
            areaPermille: totalAreaDm2 > 0 ? Math.round((areaDm2 / totalAreaDm2) * 1000) : 0,
            totalCents: entry?.totalCents ?? 0,
            byCategory: entry
              ? [...entry.byCategory.entries()]
                  .map(([category, cents]) => ({ category, cents }))
                  .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0))
              : [],
          }
        })
        .sort((a, b) => {
          const byLabel = a.label.localeCompare(b.label)
          return byLabel !== 0 ? byLabel : a.unitId.localeCompare(b.unitId)
        })
    : []

  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    totalAreaDm2,
    grossTotalCents,
    ownerTotalCents,
    allocatableTotalCents,
    units,
    unallocatableUnits,
    positions,
    diagnostics,
    ok,
  }
}
