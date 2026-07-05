import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listVendors } from '@/lib/data/vendors'
import { vendorCategoryEnum } from '@/lib/validation/vendor'
import { VendorTable } from '@/components/vendors/VendorTable'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'

const CATEGORY_OPTIONS = vendorCategoryEnum.options

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>
}) {
  const user = await requirePermission('vendors:read')
  const canWrite = can(user.role, 'vendors:write')
  const { category } = await searchParams
  // Validate the category param before passing it to listVendors: an arbitrary string
  // would 400 at PostgREST (the column is an enum). Only pass it through when it is a
  // real enum member; otherwise ignore it and show all vendors.
  const validCategory = CATEGORY_OPTIONS.find((c) => c === category)
  const supabase = await createClient()
  const vendors = await listVendors(supabase, user.workspaceId, { category: validCategory })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendors</h1>
        {canWrite && <Button render={<Link href="/vendors/new" />}>New vendor</Button>}
      </div>

      <form className="flex max-w-sm items-center gap-2">
        <select
          name="category"
          defaultValue={validCategory ?? ''}
          className="h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {vendors.length === 0 ? (
        <EmptyState
          title="No vendors yet"
          description="Add contractors and service providers so you can assign them to maintenance work."
          actionLabel={canWrite ? 'Add vendor' : undefined}
          actionHref={canWrite ? '/vendors/new' : undefined}
        />
      ) : (
        <VendorTable vendors={vendors} />
      )}
    </div>
  )
}
