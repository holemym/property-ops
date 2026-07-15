import { requirePermission } from '@/lib/auth/session'
import { TenantForm } from '@/components/tenants/TenantForm'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { createTenantAction } from '../actions'

export default async function NewPersonPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requirePermission('tenants:write')
  const { error } = await searchParams

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="New person" subtitle="Add a tenant contact record." />

      <FormError message={error} />

      <TenantForm action={createTenantAction} submitLabel="Create person" />
    </div>
  )
}
