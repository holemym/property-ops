import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listVendors } from '@/lib/data/vendors'
import { vendorCategoryEnum } from '@/lib/validation/vendor'
import { VendorTable } from '@/components/vendors/VendorTable'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
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

  const isFiltered = Boolean(validCategory)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vendors"
        subtitle="Contractors and service providers you assign to maintenance work."
        actions={canWrite && <Button render={<Link href="/vendors/new" />}>New vendor</Button>}
      />

      <form className="flex items-center gap-2">
        <select
          name="category"
          defaultValue={validCategory ?? ''}
          className="h-8 w-full max-w-sm rounded-lg border border-input bg-transparent px-2.5 text-sm capitalize outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c} className="capitalize">
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
          icon={<Wrench />}
          title={isFiltered ? 'No vendors in this category' : 'No vendors yet'}
          body={
            isFiltered
              ? 'Pick another category, or add a vendor here.'
              : 'Add contractors and service providers so you can assign them to maintenance work.'
          }
          action={
            canWrite ? (
              <Button render={<Link href="/vendors/new" />}>Add vendor</Button>
            ) : undefined
          }
        />
      ) : (
        <VendorTable vendors={vendors} />
      )}
    </div>
  )
}
