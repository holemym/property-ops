import { requirePermission } from '@/lib/auth/session'
import { VendorForm } from '@/components/vendors/VendorForm'
import { PageHeader } from '@/components/layout/PageHeader'
import { createVendorAction } from '../actions'

export default async function NewVendorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requirePermission('vendors:write')
  const { error } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New vendor" subtitle="Add a contractor or service provider." />

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <VendorForm action={createVendorAction} submitLabel="Create vendor" />
    </div>
  )
}
