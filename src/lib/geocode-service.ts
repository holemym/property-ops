import type { SupabaseClient } from '@supabase/supabase-js'
import { geocodeAddress, type AddressParts } from '@/lib/geocode'
import { updatePropertyCoordinates } from '@/lib/data/properties'

// ---------------------------------------------------------------------------
// refreshPropertyGeocode — the server-side write side of geocoding (Track M),
// mirroring src/lib/ai/triage-service.ts's runAutoTriage: it calls the disconnected-
// safe geocodeAddress() and persists the result via the SAME RLS-scoped client the
// caller already holds (a manager saving/backfilling their own workspace's property is
// already authorized to write that row — no service client needed).
//
// NEVER throws. On a successful geocode, stamps latitude/longitude/geocoded_at. On any
// failure — a Nominatim miss, or even a DB error while persisting — it explicitly NULLS
// all three, so a stale pin left over from a previous address never lingers, and
// swallows the error so a geocoding hiccup can never fail the property create/update/
// backfill that triggered it.
// ---------------------------------------------------------------------------

export async function refreshPropertyGeocode(
  supabase: SupabaseClient,
  workspaceId: string,
  propertyId: string,
  address: AddressParts
): Promise<void> {
  try {
    const result = await geocodeAddress(address)
    await updatePropertyCoordinates(supabase, workspaceId, propertyId, {
      latitude: result?.lat ?? null,
      longitude: result?.lng ?? null,
      geocoded_at: result ? new Date().toISOString() : null,
    })
  } catch (e) {
    console.error('[geocode] refreshPropertyGeocode failed for property', propertyId, e)
  }
}
