import Link from 'next/link'
import { Building2, Search } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { PropertyTable } from '@/components/properties/PropertyTable'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
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

  const isFiltered = Boolean(q)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Properties"
        subtitle="Buildings you manage, with their units, vendors, and tickets."
        actions={
          canWrite && (
            <Button render={<Link href="/properties/new" />}>New property</Button>
          )
        }
      />

      <form className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            placeholder="Search by name"
            defaultValue={q ?? ''}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {properties.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={isFiltered ? 'No matching properties' : 'No properties yet'}
          body={
            isFiltered
              ? 'Try a different name, or clear the search to see everything.'
              : 'Add your first property to start organizing units, vendors, and tickets.'
          }
          action={
            canWrite && !isFiltered ? (
              <Button render={<Link href="/properties/new" />}>Add property</Button>
            ) : undefined
          }
        />
      ) : (
        <PropertyTable properties={properties} />
      )}
    </div>
  )
}
