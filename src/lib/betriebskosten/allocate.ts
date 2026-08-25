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

// HeizKG (Austria) section 4: 55-75% of heat cost billed on measured
// consumption. Germany's HeizkostenV section 7 uses the adjacent 50-70% — a
// HeatSplitConfig may override minPermille/maxPermille per rule (migration
// 0032's settlement_allocation_rules.heat_split_min_pct/max_pct), but these
// are the module's (and the DB column defaults') Austrian default.
export const AUSTRIA_HEIZKG_MIN_PERMILLE = 550
export const AUSTRIA_HEIZKG_MAX_PERMILLE = 750

/** One category's HEATING/HOT_WATER-only positions carry HEAT-category set of
 * unit-level measured consumption (U-B, migration 0032). `consumptionUnits:
 * null` = missing/invalid reading — BLOCKS the whole run (see
 * UNIT_MISSING_CONSUMPTION_READING), never silently treated as zero, exactly
 * mirroring AllocationUnitInput.usableAreaM2's null contract. */
export type UnitConsumptionInput = {
  unitId: string
  consumptionUnits: number | null
}

/**
 * The HeizKG/HeizkostenV split for one HEATING/HOT_WATER position (U-B).
 * REQUIRED when a position's category is 'HEATING'/'HOT_WATER', FORBIDDEN
 * otherwise (see allocateBetriebskosten's contract-error THROWs). Splits the
 * position's allocatable amount into a consumption-weighted leg
 * (consumptionSplitPermille) and an area-weighted leg for the exact
 * complement — the two legs sum to allocatableAmountCents by construction,
 * and each leg independently conserves via apportionByWeight, so their
 * per-unit sums do too.
 */
export type HeatSplitConfig = {
  /** Share of the allocatable amount billed by measured consumption,
   * PER-MILLE (0..1000) — must satisfy minPermille <= consumptionSplitPermille
   * <= maxPermille. A contract error (THROWS) when out of range: this is a
   * configuration mistake a DB CHECK constraint should already have caught
   * upstream (settlement_allocation_rules_consumption_pct_in_bounds, 0032),
   * not a data-quality issue. */
  consumptionSplitPermille: number
  /** Defaults to AUSTRIA_HEIZKG_MIN_PERMILLE when omitted. */
  minPermille?: number
  /** Defaults to AUSTRIA_HEIZKG_MAX_PERMILLE when omitted. */
  maxPermille?: number
  /** Per-unit measured consumption for the CONSUMPTION leg. Same
   * null-blocks contract as UnitConsumptionInput. */
  consumption: UnitConsumptionInput[]
  /** Basis for the remainder (area) leg. Only 'USABLE_AREA' is implemented —
   * mirrors the base engine's own PER_UNIT deferral (see this module's
   * header and src/lib/data/settlements.ts's persistAllocationRun). Defaults
   * to 'USABLE_AREA' when omitted; any other value THROWS. */
  baseBasis?: 'USABLE_AREA'
}

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
  /** U-B (migration 0032). Defaults to 'USABLE_AREA' when omitted — every
   * U-A caller is unaffected. 'CONSUMPTION' apportions purely by measured
   * consumption (`consumption`, required) — e.g. cold-water sub-metering.
   * HEATING/HOT_WATER categories must NOT set this at all; they set
   * `heatSplit` instead (see HEAT_CATEGORY_REQUIRES_HEAT_SPLIT /
   * NON_HEAT_CATEGORY_WITH_HEAT_SPLIT below). */
  basis?: 'USABLE_AREA' | 'CONSUMPTION'
  /** Required (and only meaningful) when basis === 'CONSUMPTION'. One entry
   * per participating unit. */
  consumption?: UnitConsumptionInput[]
  /** REQUIRED for category 'HEATING'/'HOT_WATER', FORBIDDEN otherwise. See
   * HeatSplitConfig. */
  heatSplit?: HeatSplitConfig
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
  /** This unit's OWN Nutzflaeche in dm2 — present whenever the overall run
   * is not blocked, REGARDLESS of which basis this particular position
   * used (every unit's area is validated globally; U-B's CONSUMPTION-basis
   * positions still carry it here as display/audit context, not as their
   * weight). */
  areaDm2: number
  /** This unit's measured-consumption weight for THIS leg, in integer
   * milli-units (see the module header's scaling convention) — 0 for a
   * USABLE_AREA position/leg, and for the AREA leg specifically of a heat
   * split (its own consumptionShares entries carry the real value; the
   * COMBINED `PositionBreakdown.shares` entry carries the leg's actual
   * weight, not a sum of two incompatible dimensions). */
  consumptionMilliUnits: number
  shareCents: number
  /** Audit trail: did the largest-remainder rule add a cent here. 0|1 for
   * every position with ONE apportionment leg (every U-A position, and a
   * U-B plain CONSUMPTION-basis position). A HEATING/HOT_WATER heat-split
   * position's COMBINED share (PositionBreakdown.shares) sums TWO
   * independent legs, so it can legitimately be 0, 1, or 2 — see
   * PositionBreakdown.heatSplit for the per-leg breakdown, where each leg's
   * own shares stay 0|1. */
  roundingBonusCent: 0 | 1 | 2
}

export type PositionBreakdown = {
  positionId: string
  category: OperatingCostCategory
  /** 'CONSUMPTION' covers BOTH a plain measured-consumption position AND a
   * HEATING/HOT_WATER heat-split position — `heatSplit` below is present
   * only for the latter. */
  basis: 'USABLE_AREA' | 'CONSUMPTION'
  grossAmountCents: number
  ownerSharePermille: number
  /** Withheld from tenants. */
  ownerAmountCents: number
  /** gross - owner, the EXACT complement (no third rounding) — the invariant
   * `ownerAmountCents + allocatableAmountCents === grossAmountCents` always
   * holds, by construction. */
  allocatableAmountCents: number
  /** This position's AREA denominator — for a plain USABLE_AREA position,
   * its only denominator; for a HEAT SPLIT position, the area LEG's
   * denominator only (differs from totalAreaDm2 when participatingUnitIds
   * scopes it down). 0 for a plain CONSUMPTION (non-heat) position, which
   * has no area leg at all. */
  denominatorAreaDm2: number
  /** This position's CONSUMPTION denominator — the sum of participating
   * units' consumptionMilliUnits (see the module header's scaling
   * convention). 0 for a plain USABLE_AREA position. For a heat-split
   * position, this is the CONSUMPTION LEG's denominator specifically. */
  denominatorConsumptionMilliUnits: number
  /** Present ONLY for a HEATING/HOT_WATER heat-split position — the HeizKG
   * two-leg breakdown. consumptionLegCents + areaLegCents ===
   * allocatableAmountCents exactly, and each leg's own shares conserve to
   * that leg's cents exactly (apportionByWeight's invariant, applied
   * twice). `shares` below is the CONSERVED SUM of both legs per unit —
   * the transparent per-leg detail lives here for audit/statement
   * rendering. */
  heatSplit?: {
    consumptionSplitPermille: number
    minPermille: number
    maxPermille: number
    consumptionLegCents: number
    areaLegCents: number
    consumptionShares: UnitShare[]
    areaShares: UnitShare[]
  }
  /** [] when the overall run is blocked (`ok: false`) or when every unit
   * either has zero allocatable amount is skipped. Otherwise the COMBINED
   * per-unit result (both legs summed, for a heat-split position). */
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
  // --- U-B (migration 0032): CONSUMPTION basis + HeizKG heat split --------
  // A participating unit has no entry (or a null consumptionUnits) in the
  // position's `consumption` (or `heatSplit.consumption`) array. Mirrors
  // UNIT_MISSING_USABLE_AREA's reasoning exactly: silently excluding it would
  // redistribute that unit's true consumption cost onto every OTHER
  // participant, who would overpay — the precise legal harm HeizKG exists to
  // prevent for the heat leg, and the general RUBS harm for a plain
  // sub-metered position.
  | { code: 'UNIT_MISSING_CONSUMPTION_READING'; blocking: true; positionId: string; unitId: string }
  | { code: 'UNIT_NEGATIVE_CONSUMPTION_READING'; blocking: true; positionId: string; unitId: string; value: number }
  | { code: 'UNIT_INVALID_CONSUMPTION_READING'; blocking: true; positionId: string; unitId: string; value: number }
  | { code: 'DUPLICATE_CONSUMPTION_ENTRY'; blocking: true; positionId: string; unitId: string }
  // Every participant's consumption is 0 (or the array yielded no positive
  // weight at all) while there is positive money to distribute on this leg —
  // apportionByWeight's zero-weight guard would return [] for that leg,
  // silently dropping its cents from every unit's total (sum(units) would no
  // longer equal allocatableTotalCents). Mirrors NO_ALLOCATABLE_AREA.
  | { code: 'NO_ALLOCATABLE_CONSUMPTION'; blocking: true; positionId: string }

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
  //     + U-B (migration 0032): CONSUMPTION basis / HeizKG heat-split validity
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

  // Validates one position's `consumption` / `heatSplit.consumption` array
  // against its participant set: pushes a blocking diagnostic for anything
  // untrustworthy (missing, duplicate, negative, non-finite) and returns ONLY
  // the entries that passed. Shared by plain CONSUMPTION positions and the
  // heat split's consumption leg (never both — see the contract THROWs below).
  function validateConsumption(
    positionId: string,
    participantIds: string[],
    consumption: UnitConsumptionInput[] | undefined,
  ): Map<string, number> {
    const rawByUnit = new Map<string, number | null>()
    const seenEntries = new Set<string>()
    for (const c of consumption ?? []) {
      if (seenEntries.has(c.unitId)) {
        diagnostics.push({ code: 'DUPLICATE_CONSUMPTION_ENTRY', blocking: true, positionId, unitId: c.unitId })
        continue
      }
      seenEntries.add(c.unitId)
      rawByUnit.set(c.unitId, c.consumptionUnits)
    }
    const validated = new Map<string, number>()
    for (const uid of participantIds) {
      if (!unitIndex.has(uid)) continue // already flagged as UNKNOWN_PARTICIPATING_UNIT
      const raw = rawByUnit.has(uid) ? (rawByUnit.get(uid) as number | null) : undefined
      if (raw === undefined || raw === null) {
        // Missing/invalid/no-readings-in-period all surface as "no number for
        // this unit" by the time consumption.ts hands data to this module —
        // NEVER silently 0, which would redistribute this unit's true
        // consumption cost onto every other participant.
        diagnostics.push({ code: 'UNIT_MISSING_CONSUMPTION_READING', blocking: true, positionId, unitId: uid })
        continue
      }
      if (!Number.isFinite(raw)) {
        diagnostics.push({ code: 'UNIT_INVALID_CONSUMPTION_READING', blocking: true, positionId, unitId: uid, value: raw })
        continue
      }
      if (raw < 0) {
        // A meter rollover or physical replacement — consumption.ts is meant
        // to catch this at the source, but this module never trusts a caller
        // to have done so; defence in depth.
        diagnostics.push({ code: 'UNIT_NEGATIVE_CONSUMPTION_READING', blocking: true, positionId, unitId: uid, value: raw })
        continue
      }
      validated.set(uid, raw)
    }
    return validated
  }

  // Per-position validated consumption weights (integer milli-units — same
  // "scale once, apply identically to numerator and denominator" idiom as
  // areaDm2, see the module header), built here so the share-computation loop
  // below never re-validates (and never re-emits diagnostics for) the same data.
  const consumptionMilliUnitsByPosition = new Map<string, Map<string, number>>() // plain CONSUMPTION-basis positions
  const heatConsumptionMilliUnitsByPosition = new Map<string, Map<string, number>>() // heat-split consumption leg

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

    // --- U-B contract checks (caller/config bugs — already guarded by a DB
    // CHECK constraint upstream, migration 0032 — THROW, never degrade) -----
    const isHeatCategory = p.category === 'HEATING' || p.category === 'HOT_WATER'
    if (isHeatCategory && !p.heatSplit) {
      throw new Error(
        `allocateBetriebskosten: position '${p.id}' has category '${p.category}', which MUST set ` +
          `heatSplit — HeizKG/HeizkostenV requires every heat/hot-water position to go through the ` +
          `measured-consumption split (settlement_allocation_rules_heat_category_requires_` +
          `consumption_basis, migration 0032).`,
      )
    }
    if (!isHeatCategory && p.heatSplit) {
      throw new Error(
        `allocateBetriebskosten: position '${p.id}' has category '${p.category}' but sets heatSplit — ` +
          `the HeizKG/HeizkostenV split is only valid for category 'HEATING'/'HOT_WATER'.`,
      )
    }

    const participantIds = p.participatingUnitIds ?? [...unitIndex.keys()]
    const ownerSharePermilleForCheck = p.ownerSharePermille ?? defaultOwnerSharePermille
    const ownerAmountCentsForCheck = roundPermille(p.grossAmountCents, ownerSharePermilleForCheck)
    const allocatableAmountCentsForCheck = p.grossAmountCents - ownerAmountCentsForCheck

    if (p.heatSplit) {
      const hs = p.heatSplit
      const minPermille = hs.minPermille ?? AUSTRIA_HEIZKG_MIN_PERMILLE
      const maxPermille = hs.maxPermille ?? AUSTRIA_HEIZKG_MAX_PERMILLE
      assertPermille(`position '${p.id}' heatSplit.minPermille`, minPermille)
      assertPermille(`position '${p.id}' heatSplit.maxPermille`, maxPermille)
      if (minPermille > maxPermille) {
        throw new Error(
          `allocateBetriebskosten: position '${p.id}' heatSplit.minPermille (${minPermille}) exceeds ` +
            `heatSplit.maxPermille (${maxPermille}).`,
        )
      }
      assertPermille(`position '${p.id}' heatSplit.consumptionSplitPermille`, hs.consumptionSplitPermille)
      if (hs.consumptionSplitPermille < minPermille || hs.consumptionSplitPermille > maxPermille) {
        // The 55-75% (Austria) / 50-70% (Germany) bound, ENFORCED HERE in the
        // TypeScript contract — a DB CHECK constraint
        // (settlement_allocation_rules_consumption_pct_in_bounds, 0032)
        // enforces the same rule a second time, upstream of this call.
        throw new Error(
          `allocateBetriebskosten: position '${p.id}' heatSplit.consumptionSplitPermille ` +
            `(${hs.consumptionSplitPermille}) is outside its own bound [${minPermille}, ${maxPermille}] ` +
            `per-mille (HeizKG default 550-750; HeizkostenV 500-700 — override via heatSplit.minPermille` +
            `/maxPermille for a non-Austrian jurisdiction).`,
        )
      }
      if (hs.baseBasis !== undefined && hs.baseBasis !== 'USABLE_AREA') {
        throw new Error(
          `allocateBetriebskosten: position '${p.id}' heatSplit.baseBasis '${hs.baseBasis}' is not ` +
            `implemented — only 'USABLE_AREA' is supported for the remainder leg in this slice.`,
        )
      }

      const validated = validateConsumption(p.id, participantIds, hs.consumption)
      const milliByUnit = new Map([...validated].map(([uid, v]) => [uid, Math.round(v * 1000)]))
      heatConsumptionMilliUnitsByPosition.set(p.id, milliByUnit)

      const consumptionLegCentsForCheck = roundPermille(allocatableAmountCentsForCheck, hs.consumptionSplitPermille)
      const totalWeight = sum([...milliByUnit.values()])
      if (totalWeight <= 0 && consumptionLegCentsForCheck > 0) {
        // Every participant validated at consumption 0 (or the leg has no
        // participants at all) while there is real money to bill on this
        // leg — apportionByWeight's zero-weight guard would return [] and
        // that money would silently vanish from the reconciliation.
        diagnostics.push({ code: 'NO_ALLOCATABLE_CONSUMPTION', blocking: true, positionId: p.id })
      }
    } else if (p.basis === 'CONSUMPTION') {
      const validated = validateConsumption(p.id, participantIds, p.consumption)
      const milliByUnit = new Map([...validated].map(([uid, v]) => [uid, Math.round(v * 1000)]))
      consumptionMilliUnitsByPosition.set(p.id, milliByUnit)

      const totalWeight = sum([...milliByUnit.values()])
      if (totalWeight <= 0 && allocatableAmountCentsForCheck > 0) {
        diagnostics.push({ code: 'NO_ALLOCATABLE_CONSUMPTION', blocking: true, positionId: p.id })
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
    const areaWeights = participantIds
      .filter((id) => areaDm2ByUnit.has(id))
      .map((id) => ({ key: id, weight: areaDm2ByUnit.get(id) as number }))

    const recordTotals = (shares: UnitShare[]): void => {
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

    if (p.heatSplit) {
      // --- HeizKG/HeizkostenV heat split: two independent apportionments,
      // each conserving to its OWN leg's cents exactly, summed per unit. ----
      const hs = p.heatSplit
      const minPermille = hs.minPermille ?? AUSTRIA_HEIZKG_MIN_PERMILLE
      const maxPermille = hs.maxPermille ?? AUSTRIA_HEIZKG_MAX_PERMILLE
      const consumptionLegCents = roundPermille(allocatableAmountCents, hs.consumptionSplitPermille)
      // EXACT complement — never rounded a second time — so
      // consumptionLegCents + areaLegCents === allocatableAmountCents always,
      // mirroring the owner/allocatable split's own exact-complement pattern.
      const areaLegCents = allocatableAmountCents - consumptionLegCents

      const consumptionWeightsMap = heatConsumptionMilliUnitsByPosition.get(p.id) ?? new Map()
      const consumptionWeights = participantIds
        .filter((id) => consumptionWeightsMap.has(id))
        .map((id) => ({ key: id, weight: consumptionWeightsMap.get(id) as number }))
      const denominatorConsumptionMilliUnits = sum(consumptionWeights.map((w) => w.weight))
      const denominatorAreaDm2 = sum(areaWeights.map((w) => w.weight))

      let consumptionShares: UnitShare[] = []
      let areaShares: UnitShare[] = []
      let shares: UnitShare[] = []
      if (ok) {
        const consumptionApportioned = apportionByWeight(consumptionLegCents, consumptionWeights)
        consumptionShares = consumptionApportioned.map((a) => ({
          unitId: a.key,
          areaDm2: areaDm2ByUnit.get(a.key) as number,
          consumptionMilliUnits: consumptionWeightsMap.get(a.key) as number,
          shareCents: a.cents,
          roundingBonusCent: a.bonus,
        }))
        const areaApportioned = apportionByWeight(areaLegCents, areaWeights)
        areaShares = areaApportioned.map((a) => ({
          unitId: a.key,
          areaDm2: areaDm2ByUnit.get(a.key) as number,
          consumptionMilliUnits: 0,
          shareCents: a.cents,
          roundingBonusCent: a.bonus,
        }))

        // The combined leg carries the CONSUMPTION weight (the position's
        // reported `basis` is 'CONSUMPTION' for a heat split — see
        // src/lib/data/settlements.ts's persistAllocationRun for how this
        // becomes unit_basis_value/total_basis_value), never a sum of two
        // incompatible dimensions.
        const combined = new Map<string, { cents: number; bonus: number; consumptionMilliUnits: number }>()
        for (const s of consumptionShares) {
          combined.set(s.unitId, { cents: s.shareCents, bonus: s.roundingBonusCent, consumptionMilliUnits: s.consumptionMilliUnits })
        }
        for (const s of areaShares) {
          const prev = combined.get(s.unitId) ?? { cents: 0, bonus: 0, consumptionMilliUnits: 0 }
          combined.set(s.unitId, {
            cents: prev.cents + s.shareCents,
            bonus: prev.bonus + s.roundingBonusCent,
            consumptionMilliUnits: prev.consumptionMilliUnits,
          })
        }
        // Iterate participantIds (not Map insertion order) so the combined
        // array stays deterministic and mirrors apportionByWeight's own
        // "preserves input order" contract.
        shares = participantIds
          .filter((id) => combined.has(id))
          .map((id) => {
            const c = combined.get(id) as { cents: number; bonus: number; consumptionMilliUnits: number }
            return {
              unitId: id,
              areaDm2: areaDm2ByUnit.get(id) as number,
              consumptionMilliUnits: c.consumptionMilliUnits,
              shareCents: c.cents,
              roundingBonusCent: c.bonus as 0 | 1 | 2,
            }
          })
        recordTotals(shares)
      }

      positions.push({
        positionId: p.id,
        category: p.category,
        basis: 'CONSUMPTION',
        grossAmountCents: p.grossAmountCents,
        ownerSharePermille,
        ownerAmountCents,
        allocatableAmountCents,
        denominatorAreaDm2,
        denominatorConsumptionMilliUnits,
        heatSplit: {
          consumptionSplitPermille: hs.consumptionSplitPermille,
          minPermille,
          maxPermille,
          consumptionLegCents,
          areaLegCents,
          consumptionShares,
          areaShares,
        },
        shares,
      })
    } else if (p.basis === 'CONSUMPTION') {
      // --- plain measured-consumption basis (e.g. cold-water sub-metering) -
      const consumptionWeightsMap = consumptionMilliUnitsByPosition.get(p.id) ?? new Map()
      const consumptionWeights = participantIds
        .filter((id) => consumptionWeightsMap.has(id))
        .map((id) => ({ key: id, weight: consumptionWeightsMap.get(id) as number }))
      const denominatorConsumptionMilliUnits = sum(consumptionWeights.map((w) => w.weight))

      let shares: UnitShare[] = []
      if (ok) {
        const apportioned = apportionByWeight(allocatableAmountCents, consumptionWeights)
        shares = apportioned.map((a) => ({
          unitId: a.key,
          areaDm2: areaDm2ByUnit.get(a.key) as number,
          consumptionMilliUnits: consumptionWeightsMap.get(a.key) as number,
          shareCents: a.cents,
          roundingBonusCent: a.bonus,
        }))
        recordTotals(shares)
      }

      positions.push({
        positionId: p.id,
        category: p.category,
        basis: 'CONSUMPTION',
        grossAmountCents: p.grossAmountCents,
        ownerSharePermille,
        ownerAmountCents,
        allocatableAmountCents,
        denominatorAreaDm2: 0,
        denominatorConsumptionMilliUnits,
        shares,
      })
    } else {
      // --- default: USABLE_AREA (unchanged U-A behaviour) -------------------
      const denominatorAreaDm2 = sum(areaWeights.map((w) => w.weight))

      let shares: UnitShare[] = []
      if (ok) {
        const apportioned = apportionByWeight(allocatableAmountCents, areaWeights)
        shares = apportioned.map((a) => ({
          unitId: a.key,
          areaDm2: areaDm2ByUnit.get(a.key) as number,
          consumptionMilliUnits: 0,
          shareCents: a.cents,
          roundingBonusCent: a.bonus,
        }))
        recordTotals(shares)
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
        denominatorConsumptionMilliUnits: 0,
        shares,
      })
    }
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
