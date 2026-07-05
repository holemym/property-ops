import type { SupabaseClient } from '@supabase/supabase-js'
import type { OccupancyType, UnitStatus } from '@/types/domain'

export type Unit = {
  id: string
  workspace_id: string
  property_id: string
  label: string
  floor: string | null
  staircase: string | null
  size_m2: number | null
  room_count: number | null
  occupancy_type: OccupancyType
  status: UnitStatus
  access_notes: string | null
  wifi_info: string | null
  heating_info: string | null
  general_notes: string | null
  created_at: string
  updated_at: string
}

export type UnitFilters = {
  propertyId?: string
  status?: UnitStatus
}

export async function listUnits(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: UnitFilters = {}
): Promise<Unit[]> {
  let query = supabase.from('units').select('*').eq('workspace_id', workspaceId)
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters.status) query = query.eq('status', filters.status)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Unit[]
}

export async function getUnit(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Unit | null> {
  const { data, error } = await supabase
    .from('units').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Unit
}

export type CreateUnitInput = {
  workspaceId: string
  propertyId: string
  label: string
  floor?: string | null
  staircase?: string | null
  sizeM2?: number | null
  roomCount?: number | null
  occupancyType: OccupancyType
  status?: UnitStatus
  accessNotes?: string | null
  wifiInfo?: string | null
  heatingInfo?: string | null
  generalNotes?: string | null
}

export async function createUnit(
  supabase: SupabaseClient,
  input: CreateUnitInput
): Promise<Unit> {
  const { data, error } = await supabase
    .from('units')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId,
      label: input.label,
      floor: input.floor ?? null,
      staircase: input.staircase ?? null,
      size_m2: input.sizeM2 ?? null,
      room_count: input.roomCount ?? null,
      occupancy_type: input.occupancyType,
      status: input.status ?? 'VACANT',
      access_notes: input.accessNotes ?? null,
      wifi_info: input.wifiInfo ?? null,
      heating_info: input.heatingInfo ?? null,
      general_notes: input.generalNotes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Unit
}

// property_id is intentionally omitted from the update input: a unit's property is
// immutable after creation (moving a unit across properties is out of MVP scope, and
// the composite FK would additionally require workspace consistency).
export type UpdateUnitInput = Partial<Omit<CreateUnitInput, 'workspaceId' | 'propertyId'>>

export async function updateUnit(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateUnitInput
): Promise<Unit> {
  const payload: Record<string, unknown> = {}
  // undefined-skip / null-through: only keys explicitly present are written; an
  // explicit null clears the column (the '' -> null clear-on-edit fix), while
  // undefined leaves the column untouched.
  if (input.label !== undefined) payload.label = input.label
  if (input.floor !== undefined) payload.floor = input.floor
  if (input.staircase !== undefined) payload.staircase = input.staircase
  if (input.sizeM2 !== undefined) payload.size_m2 = input.sizeM2
  if (input.roomCount !== undefined) payload.room_count = input.roomCount
  if (input.occupancyType !== undefined) payload.occupancy_type = input.occupancyType
  if (input.status !== undefined) payload.status = input.status
  if (input.accessNotes !== undefined) payload.access_notes = input.accessNotes
  if (input.wifiInfo !== undefined) payload.wifi_info = input.wifiInfo
  if (input.heatingInfo !== undefined) payload.heating_info = input.heatingInfo
  if (input.generalNotes !== undefined) payload.general_notes = input.generalNotes

  const { data, error } = await supabase
    .from('units').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Unit
}
