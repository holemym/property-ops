import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listUnits } from '@/lib/data/units'
import { listProperties } from '@/lib/data/properties'
import { UnitTable } from '@/components/units/UnitTable'
import { EmptyState } from '@/components/common/EmptyState'
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Units</h1>
        {canWrite && <Button render={<Link href="/units/new" />}>New unit</Button>}
      </div>

      <form className="flex max-w-sm items-center gap-2">
        <select
          name="propertyId"
          defaultValue={propertyId ?? ''}
          className="h-9 w-full rounded-md border px-2 text-sm"
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
          title="No units yet"
          description="Add units to a property to track occupancy, access details, and tickets."
          actionLabel={canWrite ? 'Add unit' : undefined}
          actionHref={canWrite ? '/units/new' : undefined}
        />
      ) : (
        <UnitTable units={units} />
      )}
    </div>
  )
}
