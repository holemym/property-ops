import type { SupabaseClient } from '@supabase/supabase-js'
import type { OperatingCostCategory, AllocationBasis, SettlementStatus, MeterKind } from '@/types/domain'
import { listUnits } from '@/lib/data/units'
import { listMeters, listMeterReadings } from '@/lib/data/meters'
import { computeMeterConsumption, type MeterConsumptionInput } from '@/lib/betriebskosten/consumption'
import {
  allocateBetriebskosten,
  type AllocationResult,
  type AllocationUnitInput,
  type CostPositionInput,
  type UnitConsumptionInput,
} from '@/lib/betriebskosten/allocate'

// Betriebskosten U-A data layer (migration 0031): settlement periods, their
// master-bill cost positions, the (optional) per-category allocation-rule
// overrides, and persisting an allocation run's per-unit result. RLS scopes
// every query to the workspace + finance-eligible roles (SUPER_ADMIN/OWNER/
// OPERATOR/ACCOUNTANT read, can_manage_finance() write — the 0019 invoices
// shape); this layer applies the workspace scope + shapes writes, same
// undefined-skip/null-through convention as src/lib/data/units.ts /
// src/lib/data/invoices.ts. No UI in this slice — these functions are called
// directly (by tests, and by a later task's server actions).

// =============================================================================
// settlement_periods
// =============================================================================

export type SettlementPeriod = {
  id: string
  workspace_id: string
  property_id: string
  label: string
  period_start: string
  period_end: string
  currency: string
  status: SettlementStatus
  disclosure_deadline: string | null
  finalized_at: string | null
  finalized_by_user_id: string | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type SettlementPeriodFilters = {
  propertyId?: string
  status?: SettlementStatus
}

export async function listSettlementPeriods(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: SettlementPeriodFilters = {},
): Promise<SettlementPeriod[]> {
  let query = supabase.from('settlement_periods').select('*').eq('workspace_id', workspaceId)
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters.status) query = query.eq('status', filters.status)
  const { data, error } = await query.order('period_start', { ascending: false })
  if (error) throw error
  return data as SettlementPeriod[]
}

export async function getSettlementPeriod(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<SettlementPeriod | null> {
  const { data, error } = await supabase
    .from('settlement_periods').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as SettlementPeriod
}

export type CreateSettlementPeriodInput = {
  workspaceId: string
  createdByUserId: string
  propertyId: string
  label: string
  periodStart: string
  periodEnd: string
  currency?: string
  disclosureDeadline?: string | null
  notes?: string | null
}

// A new period is born DRAFT — mirrors createInvoice's "born DRAFT" convention.
export async function createSettlementPeriod(
  supabase: SupabaseClient,
  input: CreateSettlementPeriodInput,
): Promise<SettlementPeriod> {
  const { data, error } = await supabase
    .from('settlement_periods')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId,
      label: input.label,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      currency: input.currency ?? 'EUR',
      status: 'DRAFT',
      disclosure_deadline: input.disclosureDeadline ?? null,
      notes: input.notes ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as SettlementPeriod
}

export type UpdateSettlementPeriodInput = {
  label?: string
  periodStart?: string
  periodEnd?: string
  currency?: string
  disclosureDeadline?: string | null
  notes?: string | null
}

// Edit the period's own fields. Status transitions go through
// setSettlementPeriodStatus (below) — kept separate, same split as
// updateInvoice/setInvoiceStatus. Rejected by the DB's finalization-lock
// trigger's SIBLING guard only for the CHILD tables, not this table itself —
// but note FINALIZED/VOID periods are still writable at the RLS layer here
// (there's no analogous lock on settlement_periods itself, since editing the
// period's own label/notes after finalization is harmless bookkeeping; the
// children's amounts/allocations are what the lock protects).
export async function updateSettlementPeriod(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateSettlementPeriodInput,
): Promise<SettlementPeriod> {
  const payload: Record<string, unknown> = {}
  if (input.label !== undefined) payload.label = input.label
  if (input.periodStart !== undefined) payload.period_start = input.periodStart
  if (input.periodEnd !== undefined) payload.period_end = input.periodEnd
  if (input.currency !== undefined) payload.currency = input.currency
  if (input.disclosureDeadline !== undefined) payload.disclosure_deadline = input.disclosureDeadline
  if (input.notes !== undefined) payload.notes = input.notes
  const { data, error } = await supabase
    .from('settlement_periods').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as SettlementPeriod
}

// Set the status. Stamps finalized_at/finalized_by_user_id when ENTERING
// FINALIZED (and clears both when leaving it, e.g. a correction that reverts
// to ALLOCATED before a real finalize) — mirrors setInvoiceStatus's paid_at
// symmetry. Once FINALIZED or VOID, the settlement_child_lock_guard trigger
// (migration 0031) rejects further writes to this period's cost positions /
// allocation rules / unit allocations, for every role.
export async function setSettlementPeriodStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  status: SettlementStatus,
  finalizedByUserId?: string,
): Promise<SettlementPeriod> {
  const payload: Record<string, unknown> = {
    status,
    finalized_at: status === 'FINALIZED' ? new Date().toISOString() : null,
    finalized_by_user_id: status === 'FINALIZED' ? finalizedByUserId ?? null : null,
  }
  const { data, error } = await supabase
    .from('settlement_periods').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as SettlementPeriod
}

// =============================================================================
// settlement_cost_positions
// =============================================================================

export type SettlementCostPosition = {
  id: string
  workspace_id: string
  settlement_period_id: string
  category: OperatingCostCategory
  amount: number
  paid_on: string
  service_period_start: string | null
  service_period_end: string | null
  supplier_name: string | null
  description: string | null
  note: string | null
  document_id: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export async function listCostPositions(
  supabase: SupabaseClient,
  workspaceId: string,
  settlementPeriodId: string,
): Promise<SettlementCostPosition[]> {
  const { data, error } = await supabase
    .from('settlement_cost_positions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('settlement_period_id', settlementPeriodId)
    .order('paid_on', { ascending: false })
  if (error) throw error
  return data as SettlementCostPosition[]
}

export type CreateCostPositionInput = {
  workspaceId: string
  createdByUserId: string
  settlementPeriodId: string
  category: OperatingCostCategory
  amount: number
  paidOn: string
  servicePeriodStart?: string | null
  servicePeriodEnd?: string | null
  supplierName?: string | null
  description?: string | null
  note?: string | null
  documentId?: string | null
}

export async function createCostPosition(
  supabase: SupabaseClient,
  input: CreateCostPositionInput,
): Promise<SettlementCostPosition> {
  const { data, error } = await supabase
    .from('settlement_cost_positions')
    .insert({
      workspace_id: input.workspaceId,
      settlement_period_id: input.settlementPeriodId,
      category: input.category,
      amount: input.amount,
      paid_on: input.paidOn,
      service_period_start: input.servicePeriodStart ?? null,
      service_period_end: input.servicePeriodEnd ?? null,
      supplier_name: input.supplierName ?? null,
      description: input.description ?? null,
      note: input.note ?? null,
      document_id: input.documentId ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as SettlementCostPosition
}

export type UpdateCostPositionInput = {
  category?: OperatingCostCategory
  amount?: number
  paidOn?: string
  servicePeriodStart?: string | null
  servicePeriodEnd?: string | null
  supplierName?: string | null
  description?: string | null
  note?: string | null
  documentId?: string | null
}

export async function updateCostPosition(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateCostPositionInput,
): Promise<SettlementCostPosition> {
  const payload: Record<string, unknown> = {}
  if (input.category !== undefined) payload.category = input.category
  if (input.amount !== undefined) payload.amount = input.amount
  if (input.paidOn !== undefined) payload.paid_on = input.paidOn
  if (input.servicePeriodStart !== undefined) payload.service_period_start = input.servicePeriodStart
  if (input.servicePeriodEnd !== undefined) payload.service_period_end = input.servicePeriodEnd
  if (input.supplierName !== undefined) payload.supplier_name = input.supplierName
  if (input.description !== undefined) payload.description = input.description
  if (input.note !== undefined) payload.note = input.note
  if (input.documentId !== undefined) payload.document_id = input.documentId
  const { data, error } = await supabase
    .from('settlement_cost_positions').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as SettlementCostPosition
}

// DELETE is finance-gated at the RLS layer (0031) and rejected outright by the
// settlement_child_lock_guard trigger once the parent period is FINALIZED/VOID.
export async function deleteCostPosition(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from('settlement_cost_positions').delete().eq('workspace_id', workspaceId).eq('id', id)
  if (error) throw error
}

// =============================================================================
// settlement_allocation_rules
// =============================================================================

export type SettlementAllocationRule = {
  id: string
  workspace_id: string
  settlement_period_id: string
  category: OperatingCostCategory | null // null = the period default rule
  basis: AllocationBasis
  owner_deduction_pct: number
  // U-B (migration 0032): required together, and ONLY when basis =
  // 'CONSUMPTION' (settlement_allocation_rules_consumption_basis_requires_
  // fields) — see persistAllocationRun below for how they become a
  // HeatSplitConfig for a HEATING/HOT_WATER category.
  consumption_split_pct: number | null
  base_split_basis: AllocationBasis | null // only 'USABLE_AREA' is ever valid (DB CHECK)
  heat_split_min_pct: number | null // defaults to 55 (Austria HeizKG) at the DB layer
  heat_split_max_pct: number | null // defaults to 75 (Austria HeizKG) at the DB layer
  note: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export async function listAllocationRules(
  supabase: SupabaseClient,
  workspaceId: string,
  settlementPeriodId: string,
): Promise<SettlementAllocationRule[]> {
  const { data, error } = await supabase
    .from('settlement_allocation_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('settlement_period_id', settlementPeriodId)
  if (error) throw error
  return data as SettlementAllocationRule[]
}

export type SetAllocationRuleInput = {
  workspaceId: string
  createdByUserId: string
  settlementPeriodId: string
  category?: OperatingCostCategory | null // omitted/null = the period default rule
  basis: AllocationBasis
  ownerDeductionPct: number
  // U-B (migration 0032). REQUIRED together when basis === 'CONSUMPTION' (the
  // DB CHECK constraint rejects an incomplete set) — omit all three for a
  // plain USABLE_AREA/PER_UNIT rule.
  consumptionSplitPct?: number | null
  baseSplitBasis?: AllocationBasis | null
  // Defaults to the Austrian HeizKG 55/75 range at the DB layer when omitted
  // AND basis === 'CONSUMPTION' (column defaults) — pass explicitly to
  // configure a different jurisdiction (e.g. Germany's HeizkostenV 50/70).
  heatSplitMinPct?: number | null
  heatSplitMaxPct?: number | null
  note?: string | null
}

/**
 * Insert-or-replace the period default rule (category omitted) or a
 * per-category override (category set) — the grain `(period, category-or-
 * default)` is enforced by two PARTIAL unique indexes in the DB (one for
 * category IS NULL, one for category IS NOT NULL), which a single `.upsert()`
 * call cannot target cleanly (the two indexes have different WHERE clauses),
 * so this does an explicit select-then-update/insert instead.
 */
export async function setAllocationRule(
  supabase: SupabaseClient,
  input: SetAllocationRuleInput,
): Promise<SettlementAllocationRule> {
  const category = input.category ?? null
  let existingQuery = supabase
    .from('settlement_allocation_rules')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('settlement_period_id', input.settlementPeriodId)
  existingQuery = category === null ? existingQuery.is('category', null) : existingQuery.eq('category', category)
  const { data: existing, error: selectError } = await existingQuery.maybeSingle()
  if (selectError) throw selectError

  // consumption_split_pct/base_split_basis/heat_split_min_pct/heat_split_max_pct
  // are included ONLY when the caller explicitly passes them (undefined =
  // "leave it to the DB" — the two heat_split_*_pct columns default to the
  // Austrian HeizKG 55/75 range, migration 0032). Sending an explicit `null`
  // instead of omitting the key would defeat that DB default (Postgres only
  // applies a column DEFAULT when the key is absent from the insert, never
  // when it is present with value null), so this mirrors the undefined-skip
  // convention this module already uses for UPDATE payloads (e.g.
  // updateSettlementPeriod above), extended to INSERT here for exactly that
  // reason.
  const heatFields: Record<string, unknown> = {}
  if (input.consumptionSplitPct !== undefined) heatFields.consumption_split_pct = input.consumptionSplitPct
  if (input.baseSplitBasis !== undefined) heatFields.base_split_basis = input.baseSplitBasis
  if (input.heatSplitMinPct !== undefined) heatFields.heat_split_min_pct = input.heatSplitMinPct
  if (input.heatSplitMaxPct !== undefined) heatFields.heat_split_max_pct = input.heatSplitMaxPct

  if (existing) {
    const { data, error } = await supabase
      .from('settlement_allocation_rules')
      .update({
        basis: input.basis,
        owner_deduction_pct: input.ownerDeductionPct,
        note: input.note ?? null,
        ...heatFields,
      })
      .eq('id', (existing as SettlementAllocationRule).id)
      .select()
      .single()
    if (error) throw error
    return data as SettlementAllocationRule
  }

  const { data, error } = await supabase
    .from('settlement_allocation_rules')
    .insert({
      workspace_id: input.workspaceId,
      settlement_period_id: input.settlementPeriodId,
      category,
      basis: input.basis,
      owner_deduction_pct: input.ownerDeductionPct,
      ...heatFields,
      note: input.note ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as SettlementAllocationRule
}

// =============================================================================
// settlement_unit_allocations — read + persist an allocation run
// =============================================================================

export type SettlementUnitAllocation = {
  id: string
  workspace_id: string
  settlement_period_id: string
  unit_id: string
  category: OperatingCostCategory
  basis: AllocationBasis
  category_gross_amount: number
  owner_deduction_pct: number
  allocatable_amount: number
  unit_basis_value: number
  total_basis_value: number
  share_pct: number
  amount: number
  computed_at: string
  computed_by_user_id: string
}

export async function listUnitAllocations(
  supabase: SupabaseClient,
  workspaceId: string,
  settlementPeriodId: string,
): Promise<SettlementUnitAllocation[]> {
  const { data, error } = await supabase
    .from('settlement_unit_allocations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('settlement_period_id', settlementPeriodId)
  if (error) throw error
  return data as SettlementUnitAllocation[]
}

function amountToCents(amount: number): number {
  return Math.round(amount * 100)
}

function centsToAmount(cents: number): number {
  return cents / 100
}

function dm2ToM2(dm2: number): number {
  return dm2 / 100
}

// U-B (migration 0032): consumption weights are scaled x1000 inside the pure
// engine (src/lib/betriebskosten/allocate.ts's "milli-units" convention,
// mirroring dm2ToM2 above) — undo that here for persistence, same idea.
function milliUnitsToUnits(milliUnits: number): number {
  return milliUnits / 1000
}

function pctToPermille(pct: number): number {
  return Math.round(pct * 10)
}

export type PersistAllocationRunResult = {
  /** The pure allocator's full result — inspect `.ok`/`.diagnostics` when
   * nothing was persisted. */
  result: AllocationResult
  /** The rows written to settlement_unit_allocations. Empty when
   * `result.ok` is false — nothing is persisted for a blocked run. */
  allocations: SettlementUnitAllocation[]
}

// U-B (migration 0032): which meter kind feeds a CONSUMPTION-basis category's
// measured consumption. Deliberately narrow — only the categories this slice
// actually wires up appear here. ELECTRICITY/GAS meter kinds exist in the
// schema for future categories/a RUBS extension (see migration 0032's header)
// but no category maps to them yet.
const CATEGORY_METER_KIND: Partial<Record<OperatingCostCategory, MeterKind>> = {
  WATER_SEWER: 'COLD_WATER',
  HEATING: 'HEAT',
  HOT_WATER: 'HOT_WATER',
}

/**
 * Fetch every active meter of `kind` on the property (unit-attached only —
 * a property/common meter has no per-unit share to report here), compute
 * each meter's consumption for the period (src/lib/betriebskosten/
 * consumption.ts), and sum per unit. STICKY-null: a unit can legitimately
 * carry more than one meter of the same kind (e.g. an old meter's final
 * reading plus a replacement's first readings, both genuinely additive) —
 * but once ANY one of a unit's meters is unresolved (missing baseline, no
 * reading in period, negative delta, ...), that unit's total becomes null
 * for the rest of this position, never partially summed from only the
 * meters that happened to succeed (the same fail-closed reasoning as
 * consumption.ts's own per-meter blocking).
 */
async function buildUnitConsumption(
  supabase: SupabaseClient,
  workspaceId: string,
  propertyId: string,
  kind: MeterKind,
  periodStart: string,
  periodEnd: string,
): Promise<UnitConsumptionInput[]> {
  // NOT filtered by is_active, deliberately (RLS-review CRITICAL finding): is_active is
  // a POINT-IN-TIME flag, but a settlement covers a PAST period. When a meter is
  // replaced mid-period the old one is marked inactive — the normal lifecycle, and the
  // very case this function's doc comment above describes as legitimately additive.
  // Filtering it out silently DROPPED that half of the unit's consumption; the unit
  // still had the replacement meter, so no MISSING_READING diagnostic fired and the run
  // was not blocked. Its weight was simply understated and every other participating
  // unit made up the difference — conserving to the cent, so no sum-based test could
  // see it. Consumption is already scoped to the period by reading_date, so an
  // out-of-period meter contributes nothing anyway.
  const meters = await listMeters(supabase, workspaceId, { propertyId, kind })
  const meterInputs: MeterConsumptionInput[] = []
  for (const meter of meters) {
    if (!meter.unit_id) continue
    const readings = await listMeterReadings(supabase, workspaceId, meter.id)
    meterInputs.push({
      meterId: meter.id,
      unitId: meter.unit_id,
      multiplier: meter.multiplier,
      readings: readings.map((r) => ({ readingDate: r.reading_date, value: r.value })),
    })
  }
  const consumption = computeMeterConsumption(meterInputs, periodStart, periodEnd)

  const byUnit = new Map<string, number | null>()
  for (const r of consumption.results) {
    if (!r.unitId) continue
    const prev = byUnit.has(r.unitId) ? (byUnit.get(r.unitId) as number | null) : 0
    if (prev === null || !r.ok || r.consumptionUnits === null) {
      byUnit.set(r.unitId, null)
    } else {
      byUnit.set(r.unitId, prev + r.consumptionUnits)
    }
  }
  return [...byUnit.entries()].map(([unitId, consumptionUnits]) => ({ unitId, consumptionUnits }))
}

/**
 * Run + persist ONE settlement period's allocation: load the period's property
 * units and cost positions, resolve each category's basis/owner-deduction from
 * settlement_allocation_rules (override, else the period default, else the
 * USABLE_AREA/0% fallback), aggregate cost positions per category into cents,
 * call the pure allocateBetriebskosten, and — only when the run is not
 * blocked — replace any prior settlement_unit_allocations rows for this period
 * with the fresh result (re-running an allocation intentionally destroys the
 * prior preview; FINALIZED is the only durable checkpoint, per the design).
 *
 * THROWS (a caller/data bug, not a data-quality issue):
 *   - a resolved rule's basis is 'PER_UNIT': this slice's pure allocator
 *     still does not implement it (a deliberate U-A deferral — see the
 *     module header of src/lib/betriebskosten/allocate.ts).
 *   - a resolved rule's basis is 'CONSUMPTION' for a category with no
 *     CATEGORY_METER_KIND mapping, or a HEATING/HOT_WATER category whose
 *     rule is missing its heat-split fields or sets an unimplemented
 *     base_split_basis.
 *   - a HEATING/HOT_WATER category has NO applicable CONSUMPTION rule at all
 *     (e.g. only a USABLE_AREA period default and no category override) —
 *     this reaches allocateBetriebskosten with category HEATING/HOT_WATER
 *     and no `heatSplit`, which is a SECOND, independent, defence-in-depth
 *     THROW inside the pure engine itself (see its
 *     HEAT_CATEGORY_REQUIRES_HEAT_SPLIT contract check) — the DB CHECK
 *     constraint (migration 0032) cannot catch this particular case because
 *     it only constrains an EXPLICIT rule row, not the absence of one.
 */
export async function persistAllocationRun(
  supabase: SupabaseClient,
  workspaceId: string,
  settlementPeriodId: string,
  computedByUserId: string,
): Promise<PersistAllocationRunResult> {
  const period = await getSettlementPeriod(supabase, workspaceId, settlementPeriodId)
  if (!period) {
    throw new Error(`persistAllocationRun: no settlement period '${settlementPeriodId}' in this workspace`)
  }

  const units = await listUnits(supabase, workspaceId, { propertyId: period.property_id })
  const costPositions = await listCostPositions(supabase, workspaceId, settlementPeriodId)
  const rules = await listAllocationRules(supabase, workspaceId, settlementPeriodId)

  const defaultRule = rules.find((r) => r.category === null) ?? null
  const overrideByCategory = new Map(rules.filter((r) => r.category !== null).map((r) => [r.category, r]))

  const grossCentsByCategory = new Map<OperatingCostCategory, number>()
  for (const cp of costPositions) {
    grossCentsByCategory.set(
      cp.category,
      (grossCentsByCategory.get(cp.category) ?? 0) + amountToCents(cp.amount),
    )
  }

  const positions: CostPositionInput[] = []
  for (const [category, grossAmountCents] of grossCentsByCategory.entries()) {
    // Whole-rule fallback (override, else the period default) is equivalent
    // to per-field fallback here because basis/owner_deduction_pct are BOTH
    // `not null default ...` at the DB layer — an override row, if present,
    // always carries concrete values for both, so there is nothing for a
    // per-field fallback to add over picking the row itself.
    const rule = overrideByCategory.get(category) ?? defaultRule
    const basis: AllocationBasis = rule?.basis ?? 'USABLE_AREA'
    const ownerSharePermille = pctToPermille(rule?.owner_deduction_pct ?? 0)

    if (basis === 'PER_UNIT') {
      throw new Error(
        `persistAllocationRun: category '${category}' resolves to basis 'PER_UNIT', which the ` +
          `allocation engine does not yet implement (a deliberate, documented deferral — see ` +
          `src/lib/betriebskosten/allocate.ts's module header).`,
      )
    }

    if (basis === 'USABLE_AREA') {
      positions.push({ id: category, category, grossAmountCents, ownerSharePermille })
      continue
    }

    // basis === 'CONSUMPTION'
    const meterKind = CATEGORY_METER_KIND[category]
    if (!meterKind) {
      throw new Error(
        `persistAllocationRun: category '${category}' resolves to basis 'CONSUMPTION' but has no ` +
          `configured meter kind — see CATEGORY_METER_KIND in this module.`,
      )
    }

    if (category === 'HEATING' || category === 'HOT_WATER') {
      // rule is guaranteed non-null here: basis 'CONSUMPTION' can only come
      // from a rule row, and settlement_allocation_rules_heat_category_
      // requires_consumption_basis (0032) means a HEATING/HOT_WATER row can
      // only ever be 'CONSUMPTION' — but that constraint does not (cannot)
      // force a category-specific row to EXIST, so this null-check is the
      // one case a per-field lookup genuinely differs from `rule`.
      if (rule?.consumption_split_pct == null || rule.base_split_basis == null) {
        throw new Error(
          `persistAllocationRun: category '${category}' requires a complete heat-split rule ` +
            `(consumption_split_pct + base_split_basis) — see migration 0032's ` +
            `settlement_allocation_rules_consumption_basis_requires_fields constraint.`,
        )
      }
      if (rule.base_split_basis !== 'USABLE_AREA') {
        throw new Error(
          `persistAllocationRun: category '${category}' heat-split rule's base_split_basis ` +
            `'${rule.base_split_basis}' is not implemented — only 'USABLE_AREA' is supported.`,
        )
      }
      const consumption = await buildUnitConsumption(
        supabase, workspaceId, period.property_id, meterKind, period.period_start, period.period_end,
      )
      positions.push({
        id: category,
        category,
        grossAmountCents,
        ownerSharePermille,
        heatSplit: {
          consumptionSplitPermille: pctToPermille(rule.consumption_split_pct),
          minPermille: rule.heat_split_min_pct != null ? pctToPermille(rule.heat_split_min_pct) : undefined,
          maxPermille: rule.heat_split_max_pct != null ? pctToPermille(rule.heat_split_max_pct) : undefined,
          consumption,
          baseBasis: 'USABLE_AREA',
        },
      })
      continue
    }

    const consumption = await buildUnitConsumption(
      supabase, workspaceId, period.property_id, meterKind, period.period_start, period.period_end,
    )
    positions.push({ id: category, category, grossAmountCents, ownerSharePermille, basis: 'CONSUMPTION', consumption })
  }

  const allocationUnits: AllocationUnitInput[] = units.map((u) => ({
    unitId: u.id,
    label: u.label,
    usableAreaM2: u.usable_area_m2,
  }))

  const result = allocateBetriebskosten({
    periodStart: period.period_start,
    periodEnd: period.period_end,
    units: allocationUnits,
    positions,
  })

  if (!result.ok) {
    return { result, allocations: [] }
  }

  const { error: deleteError } = await supabase
    .from('settlement_unit_allocations')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('settlement_period_id', settlementPeriodId)
  if (deleteError) throw deleteError

  // unit_basis_value/total_basis_value report the SAME dimension as
  // `position.basis`: area (dm2 -> m2) for 'USABLE_AREA', measured
  // consumption (milli-units -> units) for 'CONSUMPTION' — INCLUDING a heat
  // split, which reports 'CONSUMPTION' (see PositionBreakdown.basis's own
  // doc). The full two-leg breakdown (consumptionLegCents/areaLegCents +
  // both legs' own per-unit shares) lives in `result.positions[].heatSplit`,
  // available to the caller immediately, but is NOT persisted at this row's
  // grain in this slice (settlement_unit_allocations is (period, unit,
  // category) — one row, one basis value; a future U-C statement can widen
  // this if the two-leg breakdown needs to survive a page reload).
  const rows = result.positions.flatMap((position) =>
    position.shares.map((share) => ({
      workspace_id: workspaceId,
      settlement_period_id: settlementPeriodId,
      unit_id: share.unitId,
      category: position.category,
      basis: position.basis,
      category_gross_amount: centsToAmount(position.grossAmountCents),
      owner_deduction_pct: pctFromPermille(position.ownerSharePermille),
      allocatable_amount: centsToAmount(position.allocatableAmountCents),
      // A HEAT-SPLIT row bills the COMBINED consumption leg + area leg, so persisting
      // the consumption leg's basis alone made the generated share_pct (unit_basis /
      // total_basis * 100) disagree with the amount actually billed — a statement line
      // reading "your share: 80%" next to an amount that is 60% of the allocatable
      // total (RLS-review HIGH). 0031's whole point is that this chain is
      // nachvollziehbar, so for a split row we persist the EFFECTIVE share: the unit's
      // own cents over the position's allocatable cents, which reconciles with `amount`
      // by construction. The per-leg detail is still returned by allocateBetriebskosten
      // for the UI; it is simply not what share_pct claims to be.
      unit_basis_value: position.heatSplit
        ? centsToAmount(share.shareCents)
        : position.basis === 'CONSUMPTION'
          ? milliUnitsToUnits(share.consumptionMilliUnits)
          : dm2ToM2(share.areaDm2),
      total_basis_value: position.heatSplit
        ? centsToAmount(position.allocatableAmountCents)
        : position.basis === 'CONSUMPTION'
          ? milliUnitsToUnits(position.denominatorConsumptionMilliUnits)
          : dm2ToM2(position.denominatorAreaDm2),
      amount: centsToAmount(share.shareCents),
      computed_by_user_id: computedByUserId,
    })),
  )

  if (rows.length === 0) {
    return { result, allocations: [] }
  }

  const { data, error: insertError } = await supabase
    .from('settlement_unit_allocations')
    .insert(rows)
    .select()
  if (insertError) throw insertError

  return { result, allocations: data as SettlementUnitAllocation[] }
}

function pctFromPermille(permille: number): number {
  return permille / 10
}
