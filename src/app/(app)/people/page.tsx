import Link from 'next/link'
import { Contact, Search } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTenants } from '@/lib/data/tenants'
import { listTenancies } from '@/lib/data/tenancies'
import { TenantTable, type TenantWithTenancyCount } from '@/components/tenants/TenantTable'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const user = await requirePermission('tenants:read')
  const canWrite = can(user.role, 'tenants:write')
  const { q } = await searchParams
  const supabase = await createClient()

  const [tenants, tenancies] = await Promise.all([
    listTenants(supabase, user.workspaceId, { search: q }),
    listTenancies(supabase, user.workspaceId),
  ])

  // Linked-tenancy count per tenant, computed from one bulk listTenancies() call
  // (mirrors /map's unitCountByProperty Map-building pattern) rather than a new
  // per-tenant data-layer call — no N+1 queries, no new lib code.
  const tenancyCountByTenant = new Map<string, number>()
  for (const tenancy of tenancies) {
    if (!tenancy.tenant_id) continue
    tenancyCountByTenant.set(tenancy.tenant_id, (tenancyCountByTenant.get(tenancy.tenant_id) ?? 0) + 1)
  }
  const tenantsWithCounts: TenantWithTenancyCount[] = tenants.map((t) => ({
    ...t,
    tenancyCount: tenancyCountByTenant.get(t.id) ?? 0,
  }))

  const isFiltered = Boolean(q)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        subtitle="Tenant contact records across your portfolio."
        actions={canWrite && <Button render={<Link href="/people/new" />} nativeButton={false}>New person</Button>}
      />

      <form className="flex items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            placeholder="Search by name"
            aria-label="Search people by name"
            defaultValue={q ?? ''}
            className="pl-8"
          />
        </div>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {tenantsWithCounts.length === 0 ? (
        <EmptyState
          icon={<Contact />}
          title={isFiltered ? 'No matching people' : 'No people yet'}
          body={
            isFiltered
              ? 'Try a different name, or clear the search to see everything.'
              : 'Add your first person to start building a tenant contact directory.'
          }
          action={
            canWrite && !isFiltered ? (
              <Button render={<Link href="/people/new" />} nativeButton={false}>Add person</Button>
            ) : undefined
          }
        />
      ) : (
        <TenantTable tenants={tenantsWithCounts} />
      )}
    </div>
  )
}
