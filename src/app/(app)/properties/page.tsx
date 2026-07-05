import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { PropertyTable } from '@/components/properties/PropertyTable'
import { EmptyState } from '@/components/common/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requirePermission('properties:read')
  const canWrite = can(user.role, 'properties:write')
  const { q } = await searchParams
  const supabase = await createClient()
  const properties = await listProperties(supabase, user.workspaceId, { search: q })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Properties</h1>
        {canWrite && (
          <Button render={<Link href="/properties/new" />}>New property</Button>
        )}
      </div>

      <form className="max-w-sm">
        <Input name="q" placeholder="Search properties..." defaultValue={q ?? ''} />
      </form>

      {properties.length === 0 ? (
        <EmptyState
          title="No properties yet"
          description="Add your first property to start organizing units, vendors, and tickets."
          actionLabel={canWrite ? 'Add property' : undefined}
          actionHref={canWrite ? '/properties/new' : undefined}
        />
      ) : (
        <PropertyTable properties={properties} />
      )}
    </div>
  )
}
