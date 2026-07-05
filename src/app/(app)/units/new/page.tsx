import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { UnitForm } from '@/components/units/UnitForm'
import { Button } from '@/components/ui/button'
import { createUnitAction } from '../actions'

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requirePermission('units:write')
  const { error } = await searchParams
  const supabase = await createClient()
  // Only ACTIVE properties are selectable — a unit cannot be attached to an archived
  // property.
  const properties = await listProperties(supabase, user.workspaceId, { status: 'ACTIVE' })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">New unit</h1>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {properties.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
          <p className="text-sm text-muted-foreground">
            You need at least one active property before you can add a unit.
          </p>
          <Button render={<Link href="/properties/new" />}>Add a property</Button>
        </div>
      ) : (
        <UnitForm action={createUnitAction} properties={properties} submitLabel="Create unit" />
      )}
    </div>
  )
}
