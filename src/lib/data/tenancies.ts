import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tenancy } from '@/types/domain'
import { getTenant } from '@/lib/data/tenants'

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
 * The logged-in TENANT's own tenancies (Phase 1B, My Home). Deliberately passes NO
 * tenant_id filter — unlike listTenancies/listTenanciesForUnit (which run under a
 * manager/accountant session and rely on tenancies_select_manager_or_accountant,
 * migration 0016, to see the whole roster), this is called with the CALLER'S OWN
 * RLS-bound client, and the additive tenancies_select_own_tenant policy (migration
 * 0030) already narrows the result to exactly the caller's own tenancy rows (via
 * their linked tenants.auth_user_id -> tenancies.tenant_id chain). Adding a
 * `.eq('tenant_id', ...)` filter here would be redundant with — and no tighter
 * than — what RLS already guarantees, so this stays a plain workspace-scoped read,
 * same shape as listTenanciesForTenant (src/lib/data/tenants.ts:137-150). Ordered
 * newest-lease-first; pickCurrentTenancy (src/lib/portal-tenancy.ts) is the pure
 * helper that then picks which one is "home" right now.
 */
export async function listMyTenancies(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Tenancy[]> {
  const { data, error } = await supabase
    .from('tenancies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('start_date', { ascending: false })
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
  // Optional link to a tenant directory record (P1-3, migration 0025). tenantName
  // is STILL required below (it's the storage column and the pre-P1 fallback), but
  // when tenantId is set, its value is ignored server-side — see the CRITICAL note.
  tenantId?: string | null
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
  // CRITICAL: when a directory person is linked, THEIR full_name is the source of
  // truth for tenant_name — never the client's copy (the <select> in
  // NewTenancyDialog auto-fills the free-text field as a UX preview, but a tampered
  // or stale form value must not be able to overwrite the directory's PII). Resolve
  // it server-side, scoped to the same workspace as the tenancy itself, and throw if
  // it doesn't resolve (wrong id, or a cross-workspace id) rather than silently
  // falling back to the client-supplied name — that would defeat the guarantee the
  // picker exists to give. A tenancy without a linked person (tenantId omitted/null)
  // keeps using the free-text tenantName exactly as before P1-3.
  let tenantName = input.tenantName
  const tenantId = input.tenantId ?? null
  if (tenantId) {
    const tenant = await getTenant(supabase, input.workspaceId, tenantId)
    if (!tenant) throw new Error('Selected person was not found in your workspace.')
    tenantName = tenant.full_name
  }

  const { data, error } = await supabase
    .from('tenancies')
    .insert({
      workspace_id: input.workspaceId,
      unit_id: input.unitId,
      created_by_user_id: input.createdByUserId,
      tenant_id: tenantId,
      tenant_name: tenantName,
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
