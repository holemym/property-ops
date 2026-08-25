import type { SupabaseClient } from '@supabase/supabase-js'
import type { MeterKind, MeterReadingSource } from '@/types/domain'

// Betriebskosten U-B data layer (migration 0032): meters + meter readings.
// RLS scopes every query to the workspace + finance-eligible roles
// (SUPER_ADMIN/OWNER/OPERATOR/ACCOUNTANT read, can_manage_finance() write —
// the SAME 0031 shape src/lib/data/settlements.ts uses); this layer applies
// the workspace scope + shapes writes, same undefined-skip/null-through
// convention as src/lib/data/units.ts / src/lib/data/settlements.ts. No UI in
// this slice — these functions are called directly (by tests, and by a
// later task's server actions).

// =============================================================================
// meters
// =============================================================================

export type Meter = {
  id: string
  workspace_id: string
  property_id: string
  unit_id: string | null // null = a property/common-area meter
  kind: MeterKind
  serial_number: string | null
  unit_of_measure: string
  multiplier: number
  is_active: boolean
  installed_at: string | null
  removed_at: string | null
  note: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type MeterFilters = {
  propertyId?: string
  unitId?: string
  kind?: MeterKind
  isActive?: boolean
}

export async function listMeters(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: MeterFilters = {},
): Promise<Meter[]> {
  let query = supabase.from('meters').select('*').eq('workspace_id', workspaceId)
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  if (filters.unitId) query = query.eq('unit_id', filters.unitId)
  if (filters.kind) query = query.eq('kind', filters.kind)
  if (filters.isActive !== undefined) query = query.eq('is_active', filters.isActive)
  const { data, error } = await query.order('created_at', { ascending: true })
  if (error) throw error
  return data as Meter[]
}

export async function getMeter(supabase: SupabaseClient, workspaceId: string, id: string): Promise<Meter | null> {
  const { data, error } = await supabase.from('meters').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Meter
}

export type CreateMeterInput = {
  workspaceId: string
  createdByUserId: string
  propertyId: string
  unitId?: string | null
  kind: MeterKind
  serialNumber?: string | null
  unitOfMeasure: string
  multiplier?: number
  isActive?: boolean
  installedAt?: string | null
  removedAt?: string | null
  note?: string | null
}

export async function createMeter(supabase: SupabaseClient, input: CreateMeterInput): Promise<Meter> {
  const { data, error } = await supabase
    .from('meters')
    .insert({
      workspace_id: input.workspaceId,
      property_id: input.propertyId,
      unit_id: input.unitId ?? null,
      kind: input.kind,
      serial_number: input.serialNumber ?? null,
      unit_of_measure: input.unitOfMeasure,
      multiplier: input.multiplier ?? 1,
      is_active: input.isActive ?? true,
      installed_at: input.installedAt ?? null,
      removed_at: input.removedAt ?? null,
      note: input.note ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as Meter
}

export type UpdateMeterInput = {
  unitId?: string | null
  kind?: MeterKind
  serialNumber?: string | null
  unitOfMeasure?: string
  multiplier?: number
  isActive?: boolean
  installedAt?: string | null
  removedAt?: string | null
  note?: string | null
}

export async function updateMeter(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateMeterInput,
): Promise<Meter> {
  const payload: Record<string, unknown> = {}
  if (input.unitId !== undefined) payload.unit_id = input.unitId
  if (input.kind !== undefined) payload.kind = input.kind
  if (input.serialNumber !== undefined) payload.serial_number = input.serialNumber
  if (input.unitOfMeasure !== undefined) payload.unit_of_measure = input.unitOfMeasure
  if (input.multiplier !== undefined) payload.multiplier = input.multiplier
  if (input.isActive !== undefined) payload.is_active = input.isActive
  if (input.installedAt !== undefined) payload.installed_at = input.installedAt
  if (input.removedAt !== undefined) payload.removed_at = input.removedAt
  if (input.note !== undefined) payload.note = input.note
  const { data, error } = await supabase
    .from('meters').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Meter
}

// DELETE is finance-gated at the RLS layer (0032). Unlike settlement children,
// meters carry no finalization lock — a mis-entered meter can always be
// removed (its readings cascade-delete with it, matching the meter_readings
// FK's on delete cascade).
export async function deleteMeter(supabase: SupabaseClient, workspaceId: string, id: string): Promise<void> {
  const { error } = await supabase.from('meters').delete().eq('workspace_id', workspaceId).eq('id', id)
  if (error) throw error
}

// =============================================================================
// meter_readings
// =============================================================================

export type MeterReading = {
  id: string
  workspace_id: string
  meter_id: string
  reading_date: string
  value: number
  source: MeterReadingSource
  note: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

export type MeterReadingFilters = {
  /** Inclusive. */
  fromDate?: string
  /** Inclusive. */
  toDate?: string
}

export async function listMeterReadings(
  supabase: SupabaseClient,
  workspaceId: string,
  meterId: string,
  filters: MeterReadingFilters = {},
): Promise<MeterReading[]> {
  let query = supabase.from('meter_readings').select('*').eq('workspace_id', workspaceId).eq('meter_id', meterId)
  if (filters.fromDate) query = query.gte('reading_date', filters.fromDate)
  if (filters.toDate) query = query.lte('reading_date', filters.toDate)
  const { data, error } = await query.order('reading_date', { ascending: true })
  if (error) throw error
  return data as MeterReading[]
}

export type CreateMeterReadingInput = {
  workspaceId: string
  createdByUserId: string
  meterId: string
  readingDate: string
  value: number
  source?: MeterReadingSource
  note?: string | null
}

export async function createMeterReading(
  supabase: SupabaseClient,
  input: CreateMeterReadingInput,
): Promise<MeterReading> {
  const { data, error } = await supabase
    .from('meter_readings')
    .insert({
      workspace_id: input.workspaceId,
      meter_id: input.meterId,
      reading_date: input.readingDate,
      value: input.value,
      source: input.source ?? 'MANUAL',
      note: input.note ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .select()
    .single()
  if (error) throw error
  return data as MeterReading
}

export type UpdateMeterReadingInput = {
  readingDate?: string
  value?: number
  source?: MeterReadingSource
  note?: string | null
}

export async function updateMeterReading(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateMeterReadingInput,
): Promise<MeterReading> {
  const payload: Record<string, unknown> = {}
  if (input.readingDate !== undefined) payload.reading_date = input.readingDate
  if (input.value !== undefined) payload.value = input.value
  if (input.source !== undefined) payload.source = input.source
  if (input.note !== undefined) payload.note = input.note
  const { data, error } = await supabase
    .from('meter_readings').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as MeterReading
}

export async function deleteMeterReading(supabase: SupabaseClient, workspaceId: string, id: string): Promise<void> {
  const { error } = await supabase.from('meter_readings').delete().eq('workspace_id', workspaceId).eq('id', id)
  if (error) throw error
}
