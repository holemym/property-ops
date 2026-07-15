import type { SupabaseClient } from '@supabase/supabase-js'
import type { Tenancy } from '@/types/domain'
import { sanitizeSearch } from '@/lib/data/search'

// A tenant directory CONTACT record (migration 0025) — the PERSON, distinct from a
// `Tenancy` (the time-ranged LEASE record in src/lib/data/tenancies.ts). PII
// (full_name/email/phone): SELECT is role-gated to managers + accountant via RLS
// (tenants_select_manager_or_accountant), identical posture to Tenancy (0016). No
// DELETE — directory entries are history-bearing (may be referenced by past
// tenancies via tenancies.tenant_id).
export type Tenant = {
  id: string
  workspace_id: string
  full_name: string
  email: string | null
  phone: string | null
  // BCP-47-ish tag (e.g. 'de', 'en'); nullable, unconstrained. Unused until P4
  // (German i18n).
  language: string | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type TenantFilters = {
  search?: string
}

/**
 * Workspace directory of tenants. RLS already scopes WHICH rows come back per role
 * (managers + accountant only — tenants carry PII, see
 * tenants_select_manager_or_accountant in 0025), so this layer just applies the
 * workspace scope + optional name/email search. Sorted by full_name for the
 * directory list (/people).
 *
 * The search filter matches full_name OR email, which needs a raw PostgREST
 * `.or()` filter string built from user input — the same injection surface the
 * global command palette guards against (src/lib/data/search.ts), so this reuses
 * that exact sanitizer rather than re-deriving the guard.
 */
export async function listTenants(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: TenantFilters = {}
): Promise<Tenant[]> {
  let query = supabase.from('tenants').select('*').eq('workspace_id', workspaceId)
  if (filters.search) {
    const q = sanitizeSearch(filters.search)
    if (q.length > 0) {
      const like = `%${q}%`
      query = query.or(`full_name.ilike.${like},email.ilike.${like}`)
    }
  }
  const { data, error } = await query.order('full_name', { ascending: true })
  if (error) throw error
  return data as Tenant[]
}

export async function getTenant(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Tenant | null> {
  const { data, error } = await supabase
    .from('tenants').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Tenant
}

export type CreateTenantInput = {
  workspaceId: string
  createdByUserId: string
  fullName: string
  email?: string | null
  phone?: string | null
  language?: string | null
  notes?: string | null
}

export async function createTenant(
  supabase: SupabaseClient,
  input: CreateTenantInput
): Promise<Tenant> {
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      workspace_id: input.workspaceId,
      created_by_user_id: input.createdByUserId,
      full_name: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      language: input.language ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Tenant
}

export type UpdateTenantInput = Partial<Omit<CreateTenantInput, 'workspaceId' | 'createdByUserId'>>

export async function updateTenant(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateTenantInput
): Promise<Tenant> {
  const payload: Record<string, unknown> = {}
  // undefined-skip / null-through: only keys explicitly present are written; an
  // explicit null clears the column, while undefined leaves it untouched (same
  // convention as updateVendor/updateProperty).
  if (input.fullName !== undefined) payload.full_name = input.fullName
  if (input.email !== undefined) payload.email = input.email
  if (input.phone !== undefined) payload.phone = input.phone
  if (input.language !== undefined) payload.language = input.language
  if (input.notes !== undefined) payload.notes = input.notes

  const { data, error } = await supabase
    .from('tenants').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Tenant
}

/**
 * The tenancies linked to a single tenant (same workspace scope), ordered by
 * start_date — mirrors listTenanciesForUnit's shape (src/lib/data/tenancies.ts)
 * but keyed by tenant_id instead of unit_id. Used by the /people/[id] detail page
 * (P1-3) to show a person's linked-tenancy history.
 */
export async function listTenanciesForTenant(
  supabase: SupabaseClient,
  workspaceId: string,
  tenantId: string
): Promise<Tenancy[]> {
  const { data, error } = await supabase
    .from('tenancies')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: true })
  if (error) throw error
  return data as Tenancy[]
}
