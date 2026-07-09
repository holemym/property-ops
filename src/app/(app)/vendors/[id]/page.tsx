import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getVendor } from '@/lib/data/vendors'
import { VendorForm } from '@/components/vendors/VendorForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/common/FormError'
import { ConfirmSubmit } from '@/components/common/ConfirmSubmit'
import { updateVendorAction, toggleVendorActiveAction } from '../actions'

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('vendors:read')
  const supabase = await createClient()
  const vendor = await getVendor(supabase, user.workspaceId, id)
  if (!vendor) notFound()

  const canWrite = can(user.role, 'vendors:write')
  const boundUpdate = updateVendorAction.bind(null, id)
  const boundToggle = toggleVendorActiveAction.bind(null, id, !vendor.is_active)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{vendor.company_name}</h1>
          <Badge variant={vendor.is_active ? 'secondary' : 'outline'}>
            {vendor.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {canWrite &&
          (vendor.is_active ? (
            <ConfirmSubmit
              action={boundToggle}
              triggerLabel="Mark inactive"
              title="Mark this vendor inactive?"
              description="They'll stop appearing in vendor pickers for new assignments. Existing tickets keep their history, and you can reactivate them anytime."
              confirmLabel="Mark inactive"
            />
          ) : (
            <form action={boundToggle}>
              <Button type="submit" variant="outline">
                Mark active
              </Button>
            </form>
          ))}
      </div>

      <FormError message={error} />

      <VendorForm
        action={boundUpdate}
        defaultValues={vendor}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />
    </div>
  )
}
