'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { propertyFormSchema } from '@/lib/validation/property'
import { createProperty, updateProperty, archiveProperty, getProperty } from '@/lib/data/properties'
import { refreshPropertyGeocode } from '@/lib/geocode-service'
import { checkRateLimit } from '@/lib/rate-limit'
import { geocodeRateLimitKey, GEOCODE_RATE_LIMIT_MAX, GEOCODE_RATE_LIMIT_WINDOW_SECONDS } from '@/lib/geocode'

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

  // Geocode-on-save (Track M): every new property gets a first geocode attempt.
  // refreshPropertyGeocode never throws, so this can never fail the create — awaited
  // only so the pin is already present the first time the manager lands on the detail
  // page (same rationale as runAutoTriage's await in tickets/actions.ts).
  //
  // Rate-limit gate: one shared Nominatim identity/IP serves every workspace on this
  // deployment (see src/lib/geocode.ts) — throttled here just means THIS save's
  // geocode attempt is skipped, same as any other best-effort geocode miss. It never
  // blocks or fails the property save itself. checkRateLimit fails open, so this is a
  // no-op (always allowed) until migration 0022 is applied.
  const canGeocode = await checkRateLimit(
    geocodeRateLimitKey(user.workspaceId),
    GEOCODE_RATE_LIMIT_MAX,
    GEOCODE_RATE_LIMIT_WINDOW_SECONDS
  )
  if (canGeocode) {
    await refreshPropertyGeocode(supabase, user.workspaceId, propertyId, {
      line1: parsed.data.addressLine1,
      postalCode: parsed.data.postalCode,
      city: parsed.data.city,
      country: parsed.data.country,
    })
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
  // Fetched BEFORE the update so the comparison below is against the pre-edit address —
  // used only for address-change detection (Track M geocode-on-save); if this lookup
  // ever came back null the update below would throw on the same missing row and
  // redirect away before addressChanged is read.
  const before = await getProperty(supabase, user.workspaceId, id)
  try {
    await updateProperty(supabase, user.workspaceId, id, parsed.data)
  } catch (e) {
    redirectWithError(`/properties/${id}`, e instanceof Error ? e.message : 'Could not save changes.')
  }

  // Geocode-on-save (Track M): only re-geocode when an address field actually changed.
  // refreshPropertyGeocode nulls the stale coords itself on a failed re-geocode — a
  // wrong pin left at the old address is worse than no pin.
  const addressChanged =
    before?.address_line1 !== parsed.data.addressLine1 ||
    before?.city !== parsed.data.city ||
    before?.postal_code !== parsed.data.postalCode ||
    before?.country !== parsed.data.country
  if (addressChanged) {
    // Rate-limit gate — same shared, workspace-scoped budget as create + the backfill
    // action (see src/lib/geocode.ts). Throttled just means this save's re-geocode is
    // skipped; the property update above has already succeeded either way.
    const canGeocode = await checkRateLimit(
      geocodeRateLimitKey(user.workspaceId),
      GEOCODE_RATE_LIMIT_MAX,
      GEOCODE_RATE_LIMIT_WINDOW_SECONDS
    )
    if (canGeocode) {
      await refreshPropertyGeocode(supabase, user.workspaceId, id, {
        line1: parsed.data.addressLine1,
        postalCode: parsed.data.postalCode,
        city: parsed.data.city,
        country: parsed.data.country,
      })
    }
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
