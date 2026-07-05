'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { vendorFormSchema } from '@/lib/validation/vendor'
import { createVendor, updateVendor, setVendorActive } from '@/lib/data/vendors'

function parseVendorForm(formData: FormData) {
  return vendorFormSchema.safeParse({
    companyName: formData.get('companyName'),
    // Optional text fields: map blank "" -> null before parsing (the template idiom),
    // so the schema's .nullable().optional() fields accept an omitted value and an
    // explicit null clears the column on edit.
    contactName: (formData.get('contactName') as string | null) || null,
    email: (formData.get('email') as string | null) || null,
    phone: (formData.get('phone') as string | null) || null,
    serviceCategory: formData.get('serviceCategory'),
    notes: (formData.get('notes') as string | null) || null,
  })
}

export async function createVendorAction(formData: FormData) {
  const user = await requirePermission('vendors:write')
  const parsed = parseVendorForm(formData)
  if (!parsed.success) {
    redirectWithError('/vendors/new', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  let vendorId: string
  try {
    const vendor = await createVendor(supabase, {
      workspaceId: user.workspaceId,
      ...parsed.data,
    })
    vendorId = vendor.id
  } catch (e) {
    // redirectWithError returns `never` (throws NEXT_REDIRECT), so control never falls
    // through to the redirect below on the error path — vendorId is definitely assigned.
    redirectWithError('/vendors/new', e instanceof Error ? e.message : 'Could not create vendor.')
  }
  revalidatePath('/vendors')
  redirect(`/vendors/${vendorId}`)
}

export async function updateVendorAction(id: string, formData: FormData) {
  const user = await requirePermission('vendors:write')
  const parsed = parseVendorForm(formData)
  if (!parsed.success) {
    redirectWithError(`/vendors/${id}`, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  try {
    await updateVendor(supabase, user.workspaceId, id, parsed.data)
  } catch (e) {
    redirectWithError(`/vendors/${id}`, e instanceof Error ? e.message : 'Could not save changes.')
  }
  revalidatePath(`/vendors/${id}`)
  revalidatePath('/vendors')
}

export async function toggleVendorActiveAction(id: string, nextActive: boolean) {
  const user = await requirePermission('vendors:write')
  const supabase = await createClient()
  try {
    await setVendorActive(supabase, user.workspaceId, id, nextActive)
  } catch (e) {
    redirectWithError(`/vendors/${id}`, e instanceof Error ? e.message : 'Could not update vendor status.')
  }
  revalidatePath(`/vendors/${id}`)
  revalidatePath('/vendors')
}
