import { requirePermission } from '@/lib/auth/session'
import { PropertyForm } from '@/components/properties/PropertyForm'
import { PageHeader } from '@/components/layout/PageHeader'
import { createPropertyAction } from '../actions'

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requirePermission('properties:write')
  const { error } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New property" subtitle="Add a property to your portfolio." />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <PropertyForm action={createPropertyAction} submitLabel="Create property" />
    </div>
  )
}
