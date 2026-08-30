import { formatMoneyIn } from '@/lib/format-money'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Home as HomeIcon, CirclePlus } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listMyTenancies } from '@/lib/data/tenancies'
import { getUnit } from '@/lib/data/units'
import { getProperty } from '@/lib/data/properties'
import { getWorkspace } from '@/lib/data/workspaces'
import { listWorkspaceOperators, type WorkspaceProfile } from '@/lib/data/tickets'
import { pickCurrentTenancy, leaseState } from '@/lib/portal-tenancy'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format-date'
import type { Role } from '@/types/domain'

// A short, tenant-friendly label for a manager's role — never the raw enum.
const ROLE_LABEL: Partial<Record<Role, string>> = {
  OWNER: 'Owner',
  OPERATOR: 'Property manager',
  SUPER_ADMIN: 'Property manager',
}

/**
 * Resolve ONE contact to show on the "Need help?" card — never the full staff roster
 * (profiles_select_self_or_workspace, migration 0002, would let a tenant read every
 * profile in the workspace, but this surface deliberately maps only a single resolved
 * person into the UI). Prefers the manager who set up this lease (tenancy.created_by_
 * user_id, if they are still an active manager); falls back to the workspace OWNER, then
 * to any active manager, so the card still has someone to show even for an old tenancy
 * created by someone since deactivated. Returns null only when the workspace has no
 * active manager at all (should not happen in practice, but the card degrades cleanly).
 */
function resolveContact(
  operators: WorkspaceProfile[],
  createdByUserId: string | null
): WorkspaceProfile | null {
  const byCreator = createdByUserId ? operators.find((p) => p.id === createdByUserId) : undefined
  return byCreator ?? operators.find((p) => p.role === 'OWNER') ?? operators[0] ?? null
}

export default async function PortalHomePage() {
  const user = await requireWorkspace()
  // Tenant-only surface, exactly like /portal "My requests" — role membership gates the
  // route, RLS (tenancies_select_own_tenant, migration 0030) does the real data scoping.
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()
  const todayIso = new Date().toISOString().slice(0, 10)

  // listMyTenancies passes NO tenant_id filter — RLS already narrows this to exactly the
  // caller's own tenancy rows (see the function's own doc comment). Picking which one is
  // "home" right now is a pure, DB-free decision (pickCurrentTenancy).
  const tenancies = await listMyTenancies(supabase, user.workspaceId)
  const tenancy = pickCurrentTenancy(tenancies, todayIso)

  // unit/property ids are derived SOLELY from the caller's own RLS-filtered tenancy —
  // never from a client-supplied id (units/properties are open-select workspace-wide,
  // so accepting an arbitrary id here would let a tenant read any unit/property).
  const [unit, workspace, operators] = await Promise.all([
    tenancy ? getUnit(supabase, user.workspaceId, tenancy.unit_id) : Promise.resolve(null),
    getWorkspace(supabase, user.workspaceId),
    listWorkspaceOperators(supabase, user.workspaceId),
  ])
  const property = unit ? await getProperty(supabase, user.workspaceId, unit.property_id) : null
  const contact = resolveContact(operators, tenancy?.created_by_user_id ?? null)
  const lease = tenancy ? leaseState(tenancy, todayIso) : null

  const currency = workspace?.currency || 'EUR'
  const money = { format: (v: number) => formatMoneyIn(currency, v) }

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />

      <PageHeader title="My home" subtitle="Your tenancy and how to reach us." />

      {!tenancy ? (
        <EmptyState
          icon={<HomeIcon />}
          title="No active tenancy"
          body="Once your property manager links you to a lease, it will show up here."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Your home
                {lease && <StatusBadge kind="lease_state" value={lease} />}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Property
                  </dt>
                  <dd className="mt-1 min-w-0 text-sm text-foreground">
                    <span className="block truncate font-medium">
                      {property?.name ?? 'Unknown property'}
                    </span>
                    {property && (
                      <span className="block break-words text-muted-foreground">
                        {property.address_line1}
                        {property.address_line2 ? `, ${property.address_line2}` : ''}, {property.postal_code}{' '}
                        {property.city}
                      </span>
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Unit
                  </dt>
                  <dd className="mt-1 min-w-0 truncate text-sm text-foreground">
                    {unit ? (
                      <>
                        {unit.label}
                        {unit.floor && <span className="text-muted-foreground"> · Floor {unit.floor}</span>}
                        {unit.staircase && (
                          <span className="text-muted-foreground"> · Staircase {unit.staircase}</span>
                        )}
                      </>
                    ) : (
                      'Unknown unit'
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Rent
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {typeof tenancy.rent_amount === 'number' ? money.format(tenancy.rent_amount) : '—'}
                  </dd>
                </div>

                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Lease term
                  </dt>
                  <dd className="mt-1 text-sm text-foreground">
                    {formatDate(tenancy.start_date)} –{' '}
                    {tenancy.end_date ? formatDate(tenancy.end_date) : 'Month-to-month'}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Need help?</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-foreground">
                  {workspace?.name ?? 'Your property manager'}
                </p>
                {contact && (
                  <p className="truncate text-muted-foreground">
                    {contact.full_name || 'Property manager'}
                    {ROLE_LABEL[contact.role] ? ` · ${ROLE_LABEL[contact.role]}` : ''}
                  </p>
                )}
              </div>
              <Button render={<Link href="/portal/new" />} nativeButton={false} variant="outline">
                <CirclePlus className="size-4" />
                Report an issue
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
