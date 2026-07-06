import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tenancy } from '@/types/domain'

/**
 * Workspace roster of tenancies (drives the occupancy timeline). RLS already scopes
 * WHICH rows come back per role (managers + accountant only — tenancies carry tenant
 * PII, see the tenancies_select_manager_or_accountant policy in 0016), so this layer
 * just applies the workspace scope. Ordered by unit then start_date so the timeline
 * builder gets a stable, per-unit-grouped stream.
 */
export async function listTenancies(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Tenancy[]> {
  const { data, error } = await supabase
    .from('tenancies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('unit_id', { ascending: true })
    .order('start_date', { ascending: true })
  if (error) throw error
  return data as Tenancy[]
}

/**
 * The tenancies for a single unit (same workspace + unit scope), ordered by start_date.
 * Trivial convenience over listTenancies for callers that only need one unit's spans.
 */
export async function listTenanciesForUnit(
  supabase: SupabaseClient,
  workspaceId: string,
  unitId: string
): Promise<Tenancy[]> {
  const { data, error } = await supabase
    .from('tenancies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('unit_id', unitId)
    .order('start_date', { ascending: true })
  if (error) throw error
  return data as Tenancy[]
}

export type CreateTenancyInput = {
  workspaceId: string
  unitId: string
  createdByUserId: string
  tenantName: string
  tenantContact?: string | null
  startDate: string
  endDate?: string | null
  rentAmount?: number | null
  notes?: string | null
}

export async function createTenancy(
  supabase: SupabaseClient,
  input: CreateTenancyInput
): Promise<Tenancy> {
  const { data, error } = await supabase
    .from('tenancies')
    .insert({
      workspace_id: input.workspaceId,
      unit_id: input.unitId,
      created_by_user_id: input.createdByUserId,
      tenant_name: input.tenantName,
      tenant_contact: input.tenantContact ?? null,
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      rent_amount: input.rentAmount ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Tenancy
}
