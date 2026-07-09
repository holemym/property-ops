import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Building2, Wrench, FileText } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getUnit } from '@/lib/data/units'
import { getProperty } from '@/lib/data/properties'
import { listTickets } from '@/lib/data/tickets'
import { listTenanciesForUnit } from '@/lib/data/tenancies'
import { listIncomeRecords, listExpenseRecords } from '@/lib/data/finance'
import { listDocuments } from '@/lib/data/documents'
import { buildUnitTimeline, defaultWindow } from '@/lib/occupancy/timeline'
import { UnitForm } from '@/components/units/UnitForm'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/EmptyState'
import { MetricStrip } from '@/components/units/hub/MetricStrip'
import { TenancyHistoryCard } from '@/components/units/hub/TenancyHistoryCard'
import { UnitOccupancyStrip } from '@/components/units/hub/UnitOccupancyStrip'
import {
  formatMoney,
  formatDate,
  humanizeEnum,
  documentTypeLabel,
  daysUntil,
  todayIso,
  TERMINAL_TICKET_STATUSES,
} from '@/components/units/hub/shared'
import { FormError } from '@/components/common/FormError'
import { updateUnitAction } from '../actions'

function coversToday(startDate: string, endDate: string | null, today: string): boolean {
  if (startDate > today) return false
  if (endDate && endDate < today) return false
  return true
}

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('units:read')
  const supabase = await createClient()

  const unit = await getUnit(supabase, user.workspaceId, id)
  if (!unit) notFound()

  const [property, allTickets, tenancies, incomeRecords, expenseRecords, documents] =
    await Promise.all([
      getProperty(supabase, user.workspaceId, unit.property_id),
      listTickets(supabase, user.workspaceId),
      listTenanciesForUnit(supabase, user.workspaceId, id),
      listIncomeRecords(supabase, user.workspaceId),
      listExpenseRecords(supabase, user.workspaceId),
      listDocuments(supabase, user.workspaceId),
    ])

  const canWrite = can(user.role, 'units:write')
  const boundUpdate = updateUnitAction.bind(null, id)
  const properties = property ? [{ id: property.id, name: property.name }] : []

  const today = todayIso()
  const window = defaultWindow(new Date())
  const segments = buildUnitTimeline(unit.status, tenancies, window)

  // Tickets / finance / documents scoped to THIS unit.
  const unitTickets = allTickets.filter((t) => t.unit_id === id)
  const openTickets = unitTickets.filter((t) => !TERMINAL_TICKET_STATUSES.includes(t.status))
  const unitExpenses = expenseRecords.filter((r) => r.unit_id === id)
  void incomeRecords
  const supersededTicketIds = new Set(
    unitExpenses.map((e) => e.ticket_id).filter((v): v is string => v !== null)
  )
  const ticketCost = unitTickets
    .filter((t) => t.actual_cost != null && !supersededTicketIds.has(t.id))
    .reduce((sum, t) => sum + (t.actual_cost ?? 0), 0)
  const maintenanceCost = unitExpenses.reduce((s, e) => s + e.amount, 0) + ticketCost

  const tenancyIds = new Set(tenancies.map((t) => t.id))
  const unitDocuments = documents.filter(
    (d) => d.unit_id === id || (d.tenancy_id !== null && tenancyIds.has(d.tenancy_id))
  )

  const currentTenancy = tenancies.find((t) => coversToday(t.start_date, t.end_date, today))
  const currentTenant = currentTenancy?.tenant_name ?? null
  const monthlyRent = currentTenancy?.rent_amount ?? null

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[--duration-slow]">
      <PageHeader
        title={`Unit ${unit.label}`}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {humanizeEnum(unit.occupancy_type)}
            </span>
            <StatusBadge kind="unit_status" value={unit.status} />
          </div>
        }
      />

      {property && (
        <p className="-mt-4 mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="size-4 shrink-0" />
          <Link
            href={`/properties/${property.id}`}
            className="hover:text-foreground hover:underline"
          >
            {property.name}
          </Link>
          {unit.floor ? <span>· Floor {unit.floor}</span> : null}
        </p>
      )}

      <FormError message={error} className="mb-6" />

      <div className="flex flex-col gap-6">
        <MetricStrip
          metrics={[
            { label: 'Status', value: humanizeEnum(unit.status) },
            { label: 'Current tenant', value: currentTenant ?? 'Vacant' },
            {
              label: 'Monthly rent',
              value: monthlyRent != null ? formatMoney(monthlyRent) : '—',
            },
            {
              label: 'Open tickets',
              value: openTickets.length,
              tone: openTickets.length > 0 ? 'amber' : 'default',
            },
            {
              label: 'Maintenance cost',
              value: formatMoney(maintenanceCost),
              tone: maintenanceCost > 0 ? 'red' : 'default',
            },
          ]}
        />

        <Card>
          <CardHeader>
            <CardTitle>Occupancy</CardTitle>
          </CardHeader>
          <CardContent>
            <UnitOccupancyStrip segments={segments} window={window} todayIso={today} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TenancyHistoryCard tenancies={tenancies} today={today} />

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Tickets</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                render={<Link href={`/tickets?propertyId=${unit.property_id}`} />}
              >
                <Wrench className="size-4" />
                View all
              </Button>
            </CardHeader>
            <CardContent>
              {unitTickets.length === 0 ? (
                <EmptyState
                  icon={<Wrench />}
                  title="No tickets for this unit"
                  body="Maintenance requests raised against this unit will appear here."
                />
              ) : (
                <ul className="flex flex-col divide-y divide-foreground/5">
                  {unitTickets.slice(0, 8).map((t) => (
                    <li key={t.id} className="py-2.5 first:pt-0 last:pb-0">
                      <Link
                        href={`/tickets/${t.id}`}
                        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"
                      >
                        <span className="truncate text-sm font-medium hover:underline">
                          {t.title}
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge kind="ticket_priority" value={t.priority} />
                          <StatusBadge kind="ticket_status" value={t.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Documents</CardTitle>
          </CardHeader>
          <CardContent>
            {unitDocuments.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="No documents"
                body="Leases, certificates, and other files attached to this unit will appear here."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-foreground/5">
                {unitDocuments.map((d) => {
                  const days = daysUntil(d.expires_at)
                  const expiring = days !== null && days <= 90
                  return (
                    <li
                      key={d.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{d.title}</span>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {documentTypeLabel(d.document_type)}
                        </span>
                      </span>
                      {d.expires_at && (
                        <span
                          className={
                            expiring
                              ? 'text-xs font-medium text-amber-700 dark:text-amber-300'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          {days !== null && days < 0 ? 'Expired ' : 'Expires '}
                          {formatDate(d.expires_at)}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Edit details — preserved from the original detail page, gated on units:write. */}
        <Card>
          <CardHeader>
            <CardTitle>Edit details</CardTitle>
          </CardHeader>
          <CardContent>
            <UnitForm
              action={boundUpdate}
              properties={properties}
              defaultValues={unit}
              submitLabel="Save changes"
              readOnly={!canWrite}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
