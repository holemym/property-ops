import type { SupabaseClient } from '@supabase/supabase-js'
import type { VendorCategory } from '@/types/domain'

export type Vendor = {
  id: string
  workspace_id: string
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  service_category: VendorCategory
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type VendorFilters = {
  category?: VendorCategory
  isActive?: boolean
}

export async function listVendors(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: VendorFilters = {}
): Promise<Vendor[]> {
  let query = supabase.from('vendors').select('*').eq('workspace_id', workspaceId)
  if (filters.category) query = query.eq('service_category', filters.category)
  // isActive is a boolean filter — check for undefined explicitly so `false`
  // (inactive-only) still applies.
  if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive)
  const { data, error } = await query.order('company_name', { ascending: true })
  if (error) throw error
  return data as Vendor[]
}

export async function getVendor(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Vendor | null> {
  const { data, error } = await supabase
    .from('vendors').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Vendor
}

export type CreateVendorInput = {
  workspaceId: string
  companyName: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  serviceCategory: VendorCategory
  notes?: string | null
}

export async function createVendor(
  supabase: SupabaseClient,
  input: CreateVendorInput
): Promise<Vendor> {
  const { data, error } = await supabase
    .from('vendors')
    .insert({
      workspace_id: input.workspaceId,
      company_name: input.companyName,
      contact_name: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      service_category: input.serviceCategory,
      notes: input.notes ?? null,
      // New vendors always start active; deactivation happens later via
      // setVendorActive (the soft-delete story — no hard DELETE exists).
      is_active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as Vendor
}

export type UpdateVendorInput = Partial<Omit<CreateVendorInput, 'workspaceId'>>

export async function updateVendor(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateVendorInput
): Promise<Vendor> {
  const payload: Record<string, unknown> = {}
  // undefined-skip / null-through: only keys explicitly present are written; an
  // explicit null clears the column (the '' -> null clear-on-edit fix), while
  // undefined leaves the column untouched.
  if (input.companyName !== undefined) payload.company_name = input.companyName
  if (input.contactName !== undefined) payload.contact_name = input.contactName
  if (input.email !== undefined) payload.email = input.email
  if (input.phone !== undefined) payload.phone = input.phone
  if (input.serviceCategory !== undefined) payload.service_category = input.serviceCategory
  if (input.notes !== undefined) payload.notes = input.notes

  const { data, error } = await supabase
    .from('vendors').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Vendor
}

// Soft-delete / restore: vendors are never hard-deleted (no DELETE RLS policy);
// is_active = false retires a vendor while preserving history for future work orders.
export async function setVendorActive(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  isActive: boolean
): Promise<Vendor> {
  const { data, error } = await supabase
    .from('vendors').update({ is_active: isActive }).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Vendor
}
