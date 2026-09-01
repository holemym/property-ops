import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DoorOpen, KeyRound, CircleCheck } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getTenant, listTenanciesForTenant } from '@/lib/data/tenants'
import { listUnits } from '@/lib/data/units'
import { listProperties } from '@/lib/data/properties'
import { TenantForm } from '@/components/tenants/TenantForm'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/format-date'
import { updateTenantAction } from '../actions'
import { inviteTenantToPortal } from '@/app/(app)/settings/users/actions'

// EUR, whole-euro (no cents) — matches the finance / rent-roll / occupancy convention
// (each feature rolls its own Intl.NumberFormat rather than sharing one; see
// src/components/units/hub/shared.ts / src/components/properties/hub/formatCurrency.ts
// for the same pattern).
const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; portal?: string }>
}) {
  const { id } = await params
  const { error, portal } = await searchParams
  const user = await requirePermission('tenants:read')
  const supabase = await createClient()
  const tenant = await getTenant(supabase, user.workspaceId, id)
  if (!tenant) notFound()

  // Every role that can reach this page (tenants:read) also holds units:read and
  // properties:read (all three are granted together to every manager role +
  // ACCOUNTANT), so these unscoped workspace fetches are safe here — RLS is still the
  // real enforcement boundary. Used only to label each linked tenancy's unit/property
  // below (mirrors the propertyName Map pattern in /occupancy and /map).
  const [tenancies, units, properties] = await Promise.all([
    listTenanciesForTenant(supabase, user.workspaceId, id),
    listUnits(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
  ])
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitInfo = new Map(
    units.map((u) => [
      u.id,
      { label: u.label, propertyName: propertyName.get(u.property_id) ?? 'Unknown property' },
    ])
  )

  const canWrite = can(user.role, 'tenants:write')
  const canInvite = can(user.role, 'users:invite')
  const boundUpdate = updateTenantAction.bind(null, id)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={tenant.full_name} subtitle="Tenant contact record." backHref="/people" backLabel="People" />

      <FormError message={error} />

      <Card>
        <CardHeader>
          <CardTitle>Portal access</CardTitle>
        </CardHeader>
        <CardContent>
          {tenant.auth_user_id ? (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <CircleCheck className="size-4 shrink-0 text-muted-foreground" />
              This person can sign in to the resident portal.
            </div>
          ) : !canInvite ? (
            <p className="text-sm text-muted-foreground">
              No portal access yet. A workspace admin can invite this person to the resident
              portal.
            </p>
          ) : tenant.email ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                Give this person a login to the resident portal, where they can submit and
                track maintenance requests. An invite goes to {tenant.email}.
              </p>
              <form action={inviteTenantToPortal}>
                <input type="hidden" name="tenantId" value={tenant.id} />
                <Button type="submit">
                  <KeyRound className="size-4" />
                  Invite to portal
                </Button>
              </form>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add an email address below to enable portal access.
            </p>
          )}
          {portal === 'invited' && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              Portal invitation sent.
            </p>
          )}
          {/* The email already had an account (inviteOrAttachUser's attach path) — no
              invite email went out, so saying "invitation sent" would be false. */}
          {portal === 'attached' && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              This resident already had an account — portal access was attached. Ask them
              to sign in at {process.env.NEXT_PUBLIC_SITE_URL ?? ''}/login.
            </p>
          )}
          {/* Portal ↔ charges linkage warning: rent invoices reach /portal/charges only
              through a tenancy whose tenant_id points at this person (RLS
              invoices_select_own_tenant, migration 0030). Portal access with zero linked
              tenancies means their charges surface will stay empty no matter what is
              invoiced against the free-text tenancy. Warning copy only — shown whenever
              this person has (or is about to get) portal access. */}
          {tenancies.length === 0 && (tenant.auth_user_id || (canInvite && tenant.email)) && (
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-500">
              No tenancy is linked to this person — rent charges won&apos;t appear in
              their portal until a tenancy links them (pick them under
              &ldquo;Person&rdquo; when recording the tenancy).
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Linked tenancies</CardTitle>
        </CardHeader>
        <CardContent>
          {tenancies.length === 0 ? (
            <EmptyState
              icon={<DoorOpen />}
              title="No linked tenancies"
              body="Tenancies recorded for this person will appear here once they're linked from a unit's occupancy record."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-foreground/5">
              {tenancies.map((t) => {
                const unit = unitInfo.get(t.unit_id)
                return (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {unit ? (
                          <Link href={`/units/${t.unit_id}`} className="hover:underline">
                            {unit.propertyName} · {unit.label}
                          </Link>
                        ) : (
                          'Unknown unit'
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(t.start_date)} –{' '}
                        {t.end_date ? formatDate(t.end_date) : 'open-ended'}
                      </div>
                    </div>
                    <div className="text-sm font-medium text-foreground tabular-nums">
                      {t.rent_amount != null ? `${formatMoney(t.rent_amount)} / mo` : '—'}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <TenantForm
        action={boundUpdate}
        defaultValues={tenant}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />
    </div>
  )
}
