import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getUnit } from '@/lib/data/units'
import { getProperty } from '@/lib/data/properties'
import { UnitForm } from '@/components/units/UnitForm'
import { StatusBadge } from '@/components/common/StatusBadge'
import { updateUnitAction } from '../actions'

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('units:read')
  const supabase = await createClient()
  const unit = await getUnit(supabase, user.workspaceId, id)
  if (!unit) notFound()

  const property = await getProperty(supabase, user.workspaceId, unit.property_id)
  const canWrite = can(user.role, 'units:write')
  const boundUpdate = updateUnitAction.bind(null, id)
  // The property select is disabled anyway (immutable), but the detail edit still needs
  // the current property in the options list for it to render its label.
  const properties = property ? [{ id: property.id, name: property.name }] : []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          Unit {unit.label}
          {property ? ` — ${property.name}` : ''}
        </h1>
        <StatusBadge status={unit.status} />
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <UnitForm
        action={boundUpdate}
        properties={properties}
        defaultValues={unit}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />
    </div>
  )
}
