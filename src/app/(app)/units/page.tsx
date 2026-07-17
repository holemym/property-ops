import Link from 'next/link'
import { DoorClosed } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listUnits } from '@/lib/data/units'
import { listProperties } from '@/lib/data/properties'
import { UnitTable } from '@/components/units/UnitTable'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'

export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<{ propertyId?: string }>
}) {
  const user = await requirePermission('units:read')
  const canWrite = can(user.role, 'units:write')
  const { propertyId: rawPropertyId } = await searchParams
  // property_id is a uuid column: a garbage ?propertyId= would 400 at PostgREST
  // and crash into the error boundary. Ignore non-uuid values instead (same
  // approach as the vendors page's enum-validated ?category filter).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined
  const supabase = await createClient()
  const [units, properties] = await Promise.all([
    listUnits(supabase, user.workspaceId, { propertyId }),
    listProperties(supabase, user.workspaceId),
  ])

  const isFiltered = Boolean(propertyId)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Units"
        subtitle="Individual units across your properties, with occupancy and access details."
        actions={canWrite && <Button render={<Link href="/units/new" />} nativeButton={false}>New unit</Button>}
      />

      <form className="flex items-center gap-2">
        <select
          name="propertyId"
          aria-label="Filter by property"
          defaultValue={propertyId ?? ''}
          className="h-8 w-full max-w-sm rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {units.length === 0 ? (
        <EmptyState
          icon={<DoorClosed />}
          title={isFiltered ? 'No units in this property' : 'No units yet'}
          body={
            isFiltered
              ? 'Pick another property, or add a unit here.'
              : 'Add units to a property to track occupancy, access details, and tickets.'
          }
          action={
            canWrite ? (
              <Button render={<Link href="/units/new" />} nativeButton={false}>Add unit</Button>
            ) : undefined
          }
        />
      ) : (
        <UnitTable units={units} />
      )}
    </div>
  )
}
