import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getProperty } from '@/lib/data/properties'
import { PropertyForm } from '@/components/properties/PropertyForm'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Button } from '@/components/ui/button'
import { updatePropertyAction, archivePropertyAction } from '../actions'

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('properties:read')
  const supabase = await createClient()
  const property = await getProperty(supabase, user.workspaceId, id)
  if (!property) notFound()

  const canWrite = can(user.role, 'properties:write')
  const boundUpdate = updatePropertyAction.bind(null, id)
  const boundArchive = archivePropertyAction.bind(null, id)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{property.name}</h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={property.status} />
          {canWrite && property.status === 'ACTIVE' && (
            <form action={boundArchive}>
              <Button type="submit" variant="outline">
                Archive
              </Button>
            </form>
          )}
        </div>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <PropertyForm
        action={boundUpdate}
        defaultValues={property}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />
    </div>
  )
}
