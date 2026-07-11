import Link from 'next/link'
import { MapPinned } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listProperties, type Property } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTickets } from '@/lib/data/tickets'
import type { TicketStatus } from '@/types/domain'
import { GEOCODE_BACKFILL_CAP } from '@/lib/geocode'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { FormError } from '@/components/common/FormError'
import { Button } from '@/components/ui/button'
import { PropertyMap, type MapProperty } from '@/components/map/PropertyMap'
import { backfillPropertyGeocodesAction } from './actions'

// Open tickets = still needing attention. Mirrors the property/unit hub + occupancy +
// analytics NON_TERMINAL definition (RESOLVED/CLOSED/CANCELLED are done). Defined locally
// so this page stays self-contained, same convention as every other hub/list page that
// needs this split.
const TERMINAL_TICKET_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED']

// Mirrors the property hub's addressParts join (src/app/(app)/properties/[id]/page.tsx) —
// includes address_line2 so two properties differing only by a unit/staircase designator
// still read as distinct in the popup.
// Until migration 0024 is applied in a given environment, Supabase's `.select('*')` omits
// latitude/longitude/geocoded_at from the row entirely — they read back as `undefined`, NOT
// `null` (see ROADMAP.md's Track M USER-action note). A `!== null` check alone would treat
// that as "located" and hand Leaflet an (undefined, undefined) LatLng, which throws. This
// type predicate treats anything that isn't an actual number as "not located" and narrows
// latitude/longitude to `number` so the .map() below needs no unsafe `as number` casts.
function hasCoordinates(
  property: Property
): property is Property & { latitude: number; longitude: number } {
  return typeof property.latitude === 'number' && typeof property.longitude === 'number'
}

function formatAddress(property: {
  address_line1: string
  address_line2: string | null
  city: string
  postal_code: string
  country: string
}): string {
  return [
    property.address_line1,
    property.address_line2,
    [property.postal_code, property.city].filter(Boolean).join(' '),
    property.country,
  ]
    .filter(Boolean)
    .join(', ')
}

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requirePermission('properties:read')
  const canManage = can(user.role, 'properties:write')
  const { error } = await searchParams
  const supabase = await createClient()

  const [properties, units, tickets] = await Promise.all([
    listProperties(supabase, user.workspaceId, { status: 'ACTIVE' }),
    listUnits(supabase, user.workspaceId),
    listTickets(supabase, user.workspaceId),
  ])

  const unitCountByProperty = new Map<string, number>()
  for (const unit of units) {
    unitCountByProperty.set(unit.property_id, (unitCountByProperty.get(unit.property_id) ?? 0) + 1)
  }
  const openTicketCountByProperty = new Map<string, number>()
  for (const ticket of tickets) {
    if (TERMINAL_TICKET_STATUSES.includes(ticket.status)) continue
    openTicketCountByProperty.set(
      ticket.property_id,
      (openTicketCountByProperty.get(ticket.property_id) ?? 0) + 1
    )
  }

  const located: MapProperty[] = properties
    .filter(hasCoordinates)
    .map((property) => ({
      id: property.id,
      name: property.name,
      address: formatAddress(property),
      latitude: property.latitude,
      longitude: property.longitude,
      unitCount: unitCountByProperty.get(property.id) ?? 0,
      openTicketCount: openTicketCountByProperty.get(property.id) ?? 0,
    }))

  const missingCount = properties.length - located.length
  // Only surface the header action once the map itself is showing — when nothing is
  // located yet the "Nothing located" EmptyState below carries the same CTA, so both
  // rendering at once would just duplicate the button.
  const showHeaderBackfill = canManage && missingCount > 0 && located.length > 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Map"
        subtitle="Your properties, plotted by address."
        actions={
          showHeaderBackfill ? (
            <form action={backfillPropertyGeocodesAction}>
              <Button type="submit" variant="outline">
                Locate {Math.min(missingCount, GEOCODE_BACKFILL_CAP)} missing
              </Button>
            </form>
          ) : undefined
        }
      />

      <FormError message={error} />

      {properties.length === 0 ? (
        <EmptyState
          icon={<MapPinned />}
          title="No properties yet"
          body="Add your first property to see it plotted on the map."
          action={
            canManage ? <Button render={<Link href="/properties/new" />}>Add property</Button> : undefined
          }
        />
      ) : located.length === 0 ? (
        <EmptyState
          icon={<MapPinned />}
          title="Nothing located yet"
          body="None of your properties have coordinates yet. Locate them to plot them on the map."
          action={
            canManage ? (
              <form action={backfillPropertyGeocodesAction}>
                <Button type="submit">Locate missing</Button>
              </form>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {located.length} of {properties.length} properties located
          </p>
          <PropertyMap properties={located} />
        </>
      )}
    </div>
  )
}
