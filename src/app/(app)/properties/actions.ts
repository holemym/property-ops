'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { propertyFormSchema } from '@/lib/validation/property'
import { createProperty, updateProperty, archiveProperty } from '@/lib/data/properties'

function parsePropertyForm(formData: FormData) {
  return propertyFormSchema.safeParse({
    name: formData.get('name'),
    addressLine1: formData.get('addressLine1'),
    addressLine2: (formData.get('addressLine2') as string | null) || null,
    city: formData.get('city'),
    postalCode: formData.get('postalCode'),
    country: formData.get('country'),
    propertyType: formData.get('propertyType'),
    notes: (formData.get('notes') as string | null) || null,
  })
}

export async function createPropertyAction(formData: FormData) {
  const user = await requirePermission('properties:write')
  const parsed = parsePropertyForm(formData)
  if (!parsed.success) {
    redirectWithError('/properties/new', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  let propertyId: string
  try {
    const property = await createProperty(supabase, { workspaceId: user.workspaceId, ...parsed.data })
    propertyId = property.id
  } catch (e) {
    // redirectWithError returns `never` (throws NEXT_REDIRECT), so control never falls
    // through to the redirect below on the error path — propertyId is definitely assigned.
    redirectWithError('/properties/new', e instanceof Error ? e.message : 'Could not create property.')
  }
  revalidatePath('/properties')
  redirect(`/properties/${propertyId}`)
}

export async function updatePropertyAction(id: string, formData: FormData) {
  const user = await requirePermission('properties:write')
  const parsed = parsePropertyForm(formData)
  if (!parsed.success) {
    redirectWithError(`/properties/${id}`, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  try {
    await updateProperty(supabase, user.workspaceId, id, parsed.data)
  } catch (e) {
    redirectWithError(`/properties/${id}`, e instanceof Error ? e.message : 'Could not save changes.')
  }
  revalidatePath(`/properties/${id}`)
  revalidatePath('/properties')
}

export async function archivePropertyAction(id: string) {
  const user = await requirePermission('properties:write')
  const supabase = await createClient()
  try {
    await archiveProperty(supabase, user.workspaceId, id)
  } catch (e) {
    redirectWithError(`/properties/${id}`, e instanceof Error ? e.message : 'Could not archive property.')
  }
  revalidatePath('/properties')
  redirect('/properties')
}
