import type { SupabaseClient } from '@supabase/supabase-js'
import type { OperatingCostCategory, AllocationBasis, SettlementStatus } from '@/types/domain'
import { listUnits } from '@/lib/data/units'
import {
  allocateBetriebskosten,
  type AllocationResult,
  type AllocationUnitInput,
  type CostPositionInput,
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
  consumption_split_pct: number | null // U-B seam, unused in U-A
  base_split_basis: AllocationBasis | null // U-B seam, unused in U-A
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

  if (existing) {
    const { data, error } = await supabase
      .from('settlement_allocation_rules')
      .update({
        basis: input.basis,
        owner_deduction_pct: input.ownerDeductionPct,
        note: input.note ?? null,
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
 * THROWS (a caller/data bug, not a data-quality issue) when a resolved rule's
 * basis is not 'USABLE_AREA': this slice's pure allocator only implements the
 * MRG section 17 area-proportional key. PER_UNIT is a valid value in the
 * `allocation_basis` DB enum (reserved for a category like ELEVATOR that some
 * operators may configure), but wiring it into the engine is explicitly
 * deferred — see the module header of src/lib/betriebskosten/allocate.ts and
 * this task's final report. Choosing PER_UNIT for a rule today is stored fine;
 * running the allocation with it throws a clear, named error rather than
 * silently mis-computing.
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

  const positions: CostPositionInput[] = [...grossCentsByCategory.entries()].map(([category, grossAmountCents]) => {
    const override = overrideByCategory.get(category)
    const basis: AllocationBasis = override?.basis ?? defaultRule?.basis ?? 'USABLE_AREA'
    const ownerDeductionPct = override?.owner_deduction_pct ?? defaultRule?.owner_deduction_pct ?? 0
    if (basis !== 'USABLE_AREA') {
      throw new Error(
        `persistAllocationRun: category '${category}' resolves to basis '${basis}', which the U-A ` +
          `allocation engine does not yet implement (only USABLE_AREA is supported in this slice).`,
      )
    }
    return {
      id: category,
      category,
      grossAmountCents,
      ownerSharePermille: pctToPermille(ownerDeductionPct),
    }
  })

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
      unit_basis_value: dm2ToM2(share.areaDm2),
      total_basis_value: dm2ToM2(position.denominatorAreaDm2),
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
