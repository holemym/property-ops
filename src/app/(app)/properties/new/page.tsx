import { PropertyForm } from '@/components/properties/PropertyForm'
import { createPropertyAction } from '../actions'

export default async function NewPropertyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">New property</h1>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <PropertyForm action={createPropertyAction} submitLabel="Create property" />
    </div>
  )
}
