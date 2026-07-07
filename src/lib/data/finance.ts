import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExpenseRecord, IncomeRecord } from '@/types/domain'

/**
 * Workspace ledger of income entries (drives the finance page + profit-per-unit).
 * RLS already scopes WHICH rows come back per role (SUPER_ADMIN / OWNER / OPERATOR /
 * ACCOUNTANT within the workspace — see income_records_select_finance in 0017; tenants,
 * guests and vendors get zero rows), so this layer just applies the workspace scope.
 * Ordered newest-period-first.
 */
export async function listIncomeRecords(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<IncomeRecord[]> {
  const { data, error } = await supabase
    .from('income_records')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('period_start', { ascending: false })
  if (error) throw error
  return data as IncomeRecord[]
}

/**
 * Workspace ledger of expense entries. Same RLS scoping as income (SELECT includes
 * OPERATOR for cost visibility; writes do not — the finance role inversion). Ordered by
 * incurred_on, newest-first.
 */
export async function listExpenseRecords(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<ExpenseRecord[]> {
  const { data, error } = await supabase
    .from('expense_records')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('incurred_on', { ascending: false })
  if (error) throw error
  return data as ExpenseRecord[]
}

// currency is optional at the call site: the DB column defaults to 'EUR', but the app
// path sends an explicit value so the fake in-memory test client (which does not model
// column defaults) gets a currency too. propertyId / unitId are OPTIONAL attribution
// (NULLABLE composite FKs in 0017) — an omitted attribution books the income at the
// workspace level. periodEnd null = point-in-time booking.
export type CreateIncomeInput = {
  workspaceId: string
  createdByUserId: string
  amount: number
  currency?: string
  category: IncomeRecord['category']
  periodStart: string
  periodEnd?: string | null
  propertyId?: string | null
  unitId?: string | null
  notes?: string | null
}

export async function createIncomeRecord(
  supabase: SupabaseClient,
  input: CreateIncomeInput
): Promise<IncomeRecord> {
  const { data, error } = await supabase
    .from('income_records')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId ?? null,
      unit_id: input.unitId ?? null,
      amount: input.amount,
      currency: input.currency ?? 'EUR',
      category: input.category,
      period_start: input.periodStart,
      period_end: input.periodEnd ?? null,
      notes: input.notes ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as IncomeRecord
}

// Same shape as CreateIncomeInput with the income period pair replaced by a single
// required incurred_on, plus an OPTIONAL ticket_id (links a manual expense back to the
// ticket it settles; analytics dedupes these against the ticket's actual_cost — see 0017).
export type CreateExpenseInput = {
  workspaceId: string
  createdByUserId: string
  amount: number
  currency?: string
  category: ExpenseRecord['category']
  incurredOn: string
  propertyId?: string | null
  unitId?: string | null
  ticketId?: string | null
  notes?: string | null
}

export async function createExpenseRecord(
  supabase: SupabaseClient,
  input: CreateExpenseInput
): Promise<ExpenseRecord> {
  const { data, error } = await supabase
    .from('expense_records')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId ?? null,
      unit_id: input.unitId ?? null,
      ticket_id: input.ticketId ?? null,
      amount: input.amount,
      currency: input.currency ?? 'EUR',
      category: input.category,
      incurred_on: input.incurredOn,
      notes: input.notes ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as ExpenseRecord
}
