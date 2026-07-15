'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { tenantFormSchema } from '@/lib/validation/tenant'
import { createTenant, updateTenant } from '@/lib/data/tenants'

function parseTenantForm(formData: FormData) {
  return tenantFormSchema.safeParse({
    fullName: formData.get('fullName'),
    // Optional text fields: map blank "" -> null before parsing (the template idiom),
    // so the schema's .nullable().optional() fields accept an omitted value and an
    // explicit null clears the column on edit. Mirrors parseVendorForm exactly.
    email: (formData.get('email') as string | null) || null,
    phone: (formData.get('phone') as string | null) || null,
    language: (formData.get('language') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
  })
}

export async function createTenantAction(formData: FormData) {
  const user = await requirePermission('tenants:write')
  const parsed = parseTenantForm(formData)
  if (!parsed.success) {
    redirectWithError('/people/new', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  let tenantId: string
  try {
    const tenant = await createTenant(supabase, {
      workspaceId: user.workspaceId,
      createdByUserId: user.id,
      ...parsed.data,
    })
    tenantId = tenant.id
  } catch (e) {
    // redirectWithError returns `never` (throws NEXT_REDIRECT), so control never falls
    // through to the redirect below on the error path — tenantId is definitely assigned.
    redirectWithError('/people/new', e instanceof Error ? e.message : 'Could not create person.')
  }
  revalidatePath('/people')
  redirect(`/people/${tenantId}`)
}

export async function updateTenantAction(id: string, formData: FormData) {
  const user = await requirePermission('tenants:write')
  const parsed = parseTenantForm(formData)
  if (!parsed.success) {
    redirectWithError(`/people/${id}`, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  try {
    await updateTenant(supabase, user.workspaceId, id, parsed.data)
  } catch (e) {
    redirectWithError(`/people/${id}`, e instanceof Error ? e.message : 'Could not save changes.')
  }
  revalidatePath(`/people/${id}`)
  revalidatePath('/people')
}
