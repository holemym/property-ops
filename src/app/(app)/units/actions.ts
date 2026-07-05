'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { unitFormSchema } from '@/lib/validation/unit'
import { createUnit, updateUnit } from '@/lib/data/units'
import { getProperty } from '@/lib/data/properties'

function parseUnitForm(formData: FormData) {
  return unitFormSchema.safeParse({
    label: formData.get('label'),
    floor: (formData.get('floor') as string | null) || null,
    staircase: (formData.get('staircase') as string | null) || null,
    // `|| null` maps both "" and "0" to null for these numeric optionals; 0 is not a
    // meaningful size/room-count, so treating "0" as unset is acceptable (see schema).
    sizeM2: (formData.get('sizeM2') as string | null) || null,
    roomCount: (formData.get('roomCount') as string | null) || null,
    occupancyType: formData.get('occupancyType'),
    accessNotes: (formData.get('accessNotes') as string | null) || null,
    wifiInfo: (formData.get('wifiInfo') as string | null) || null,
    heatingInfo: (formData.get('heatingInfo') as string | null) || null,
    generalNotes: (formData.get('generalNotes') as string | null) || null,
  })
}

export async function createUnitAction(formData: FormData) {
  const user = await requirePermission('units:write')
  const parsed = parseUnitForm(formData)
  if (!parsed.success) {
    redirectWithError('/units/new', parsed.error.issues[0].message)
  }

  const propertyId = formData.get('propertyId') as string | null
  if (!propertyId) {
    redirectWithError('/units/new', 'A property is required.')
  }

  const supabase = await createClient()
  // Friendly ownership check: verify the property belongs to the caller's workspace
  // before insert. getProperty is workspace-scoped, so a property_id from another
  // workspace returns null here and we redirect with a readable error. The DB
  // composite FK (units_property_fk) is the un-bypassable backstop.
  const property = await getProperty(supabase, user.workspaceId, propertyId!)
  if (!property) {
    redirectWithError('/units/new', 'Selected property was not found in your workspace.')
  }

  let unitId: string
  try {
    const unit = await createUnit(supabase, {
      workspaceId: user.workspaceId,
      propertyId: propertyId!,
      ...parsed.data,
    })
    unitId = unit.id
  } catch (e) {
    // redirectWithError returns `never` (throws NEXT_REDIRECT), so control never falls
    // through to the redirect below on the error path — unitId is definitely assigned.
    redirectWithError('/units/new', e instanceof Error ? e.message : 'Could not create unit.')
  }
  revalidatePath('/units')
  redirect(`/units/${unitId}`)
}

export async function updateUnitAction(id: string, formData: FormData) {
  const user = await requirePermission('units:write')
  const parsed = parseUnitForm(formData)
  if (!parsed.success) {
    redirectWithError(`/units/${id}`, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  // Note: property_id is NOT accepted here — a unit's property is immutable after
  // creation (out of MVP scope). parsed.data carries no propertyId, so updateUnit
  // never touches it.
  try {
    await updateUnit(supabase, user.workspaceId, id, parsed.data)
  } catch (e) {
    redirectWithError(`/units/${id}`, e instanceof Error ? e.message : 'Could not save changes.')
  }
  revalidatePath(`/units/${id}`)
  revalidatePath('/units')
}
