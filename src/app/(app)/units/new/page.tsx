import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { UnitForm } from '@/components/units/UnitForm'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { EmptyState } from '@/components/common/EmptyState'
import { createUnitAction } from '../actions'

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; propertyId?: string }>
}) {
  const user = await requirePermission('units:write')
  const { error, propertyId: rawPropertyId } = await searchParams
  const supabase = await createClient()
  // Only ACTIVE properties are selectable — a unit cannot be attached to an archived
  // property.
  const properties = await listProperties(supabase, user.workspaceId, { status: 'ACTIVE' })
  // ?propertyId= preselects the property (the hub's "Add unit" passes it) — membership
  // in the fetched list doubles as the UUID/workspace guard, so a garbage or foreign id
  // just falls back to the default. Without this, the form defaulted to the NEWEST
  // property (created_at desc), silently wrong the moment a second property exists.
  const defaultPropertyId = properties.some((p) => p.id === rawPropertyId)
    ? rawPropertyId
    : undefined

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New unit" subtitle="Add a unit to one of your properties." />

      <FormError message={error} />

      {properties.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="Add a property first"
          body="You need at least one active property before you can add a unit."
          action={<Button render={<Link href="/properties/new" />} nativeButton={false}>Add a property</Button>}
        />
      ) : (
        <UnitForm
          action={createUnitAction}
          properties={properties}
          defaultValues={defaultPropertyId ? { property_id: defaultPropertyId } : undefined}
          submitLabel="Create unit"
        />
      )}
    </div>
  )
}
