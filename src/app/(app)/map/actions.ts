'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { listProperties } from '@/lib/data/properties'
import { refreshPropertyGeocode } from '@/lib/geocode-service'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  geocodeRateLimitKey,
  GEOCODE_RATE_LIMIT_MAX,
  GEOCODE_RATE_LIMIT_WINDOW_SECONDS,
  GEOCODE_BACKFILL_CAP,
} from '@/lib/geocode'

// Nominatim's usage policy caps free-tier use to 1 request/second (see the header of
// src/lib/geocode.ts) — this loop serializes with a small safety margin over that
// floor.
const BACKFILL_DELAY_MS = 1100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Manager-only backfill (Track M — the button lives on /map, wired in M2). Geocodes up
 * to GEOCODE_BACKFILL_CAP ACTIVE properties that are still missing coordinates, one at a
 * time with a BACKFILL_DELAY_MS gap between calls (Nominatim policy compliance). Never
 * throws on a per-property basis: refreshPropertyGeocode already swallows its own
 * errors, so one bad address can never abort the rest of the batch.
 */
export async function backfillPropertyGeocodesAction(): Promise<void> {
  const user = await requirePermission('properties:write')

  // Rate-limit gate — same shared, workspace-scoped budget as the per-save geocoding
  // in properties/actions.ts (see src/lib/geocode.ts). Unlike a single save, backfill
  // IS the whole point of this action, so a throttled bucket fails the WHOLE attempt
  // up front with a friendly message rather than silently burning through part of the
  // shared Nominatim budget and stopping partway with no explanation. checkRateLimit
  // fails open, so this is a no-op (always allowed) until migration 0022 is applied.
  const canGeocode = await checkRateLimit(
    geocodeRateLimitKey(user.workspaceId),
    GEOCODE_RATE_LIMIT_MAX,
    GEOCODE_RATE_LIMIT_WINDOW_SECONDS
  )
  if (!canGeocode) {
    redirectWithError('/map', 'Too many geocoding requests right now — try again in a minute.')
  }

  const supabase = await createClient()

  const properties = await listProperties(supabase, user.workspaceId, { status: 'ACTIVE' })
  const missing = properties
    .filter((property) => property.latitude === null || property.longitude === null)
    .slice(0, GEOCODE_BACKFILL_CAP)

  for (const [index, property] of missing.entries()) {
    await refreshPropertyGeocode(supabase, user.workspaceId, property.id, {
      line1: property.address_line1,
      postalCode: property.postal_code,
      city: property.city,
      country: property.country,
    })
    if (index < missing.length - 1) await sleep(BACKFILL_DELAY_MS)
  }

  revalidatePath('/map')
}
