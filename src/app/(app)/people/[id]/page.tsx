import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/data/tenants'
import { TenantForm } from '@/components/tenants/TenantForm'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { updateTenantAction } from '../actions'

// The linked-tenancies card (unit label, property, span, rent — from
// listTenanciesForTenant) is P1-3's addition; this page intentionally stops at the
// edit form so that work slots in as a sibling block inside the same flex-col wrapper
// without restructuring anything here.
export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('tenants:read')
  const supabase = await createClient()
  const tenant = await getTenant(supabase, user.workspaceId, id)
  if (!tenant) notFound()

  const canWrite = can(user.role, 'tenants:write')
  const boundUpdate = updateTenantAction.bind(null, id)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tenant.full_name} subtitle="Tenant contact record." />

      <FormError message={error} />

      <TenantForm
        action={boundUpdate}
        defaultValues={tenant}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />
    </div>
  )
}
