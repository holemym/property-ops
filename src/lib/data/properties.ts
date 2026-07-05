import type { SupabaseClient } from '@supabase/supabase-js'
import type { PropertyType, EntityStatus } from '@/types/domain'

export type Property = {
  id: string
  workspace_id: string
  name: string
  address_line1: string
  address_line2: string | null
  city: string
  postal_code: string
  country: string
  property_type: PropertyType
  notes: string | null
  status: EntityStatus
  created_at: string
  updated_at: string
}

export type PropertyFilters = {
  search?: string
  status?: EntityStatus
}

export async function listProperties(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: PropertyFilters = {}
): Promise<Property[]> {
  let query = supabase.from('properties').select('*').eq('workspace_id', workspaceId)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.search) query = query.ilike('name', `%${filters.search}%`)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Property[]
}

export async function getProperty(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Property | null> {
  const { data, error } = await supabase
    .from('properties').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Property
}

export type CreatePropertyInput = {
  workspaceId: string
  name: string
  addressLine1: string
  addressLine2?: string
  city: string
  postalCode: string
  country: string
  propertyType: PropertyType
  notes?: string
}

export async function createProperty(
  supabase: SupabaseClient,
  input: CreatePropertyInput
): Promise<Property> {
  const { data, error } = await supabase
    .from('properties')
    .insert({
      workspace_id: input.workspaceId,
      name: input.name,
      address_line1: input.addressLine1,
      address_line2: input.addressLine2 ?? null,
      city: input.city,
      postal_code: input.postalCode,
      country: input.country,
      property_type: input.propertyType,
      notes: input.notes ?? null,
      status: 'ACTIVE',
    })
    .select()
    .single()
  if (error) throw error
  return data as Property
}

export type UpdatePropertyInput = Partial<CreatePropertyInput>

export async function updateProperty(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdatePropertyInput
): Promise<Property> {
  const payload: Record<string, unknown> = {}
  if (input.name !== undefined) payload.name = input.name
  if (input.addressLine1 !== undefined) payload.address_line1 = input.addressLine1
  if (input.addressLine2 !== undefined) payload.address_line2 = input.addressLine2
  if (input.city !== undefined) payload.city = input.city
  if (input.postalCode !== undefined) payload.postal_code = input.postalCode
  if (input.country !== undefined) payload.country = input.country
  if (input.propertyType !== undefined) payload.property_type = input.propertyType
  if (input.notes !== undefined) payload.notes = input.notes

  const { data, error } = await supabase
    .from('properties').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Property
}

export async function archiveProperty(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Property> {
  const { data, error } = await supabase
    .from('properties').update({ status: 'ARCHIVED' }).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Property
}
