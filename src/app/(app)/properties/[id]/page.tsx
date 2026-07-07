import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DoorClosed, MapPin, Wrench } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getProperty } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTickets } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'
import { listIncomeRecords, listExpenseRecords } from '@/lib/data/finance'
import { listDocuments } from '@/lib/data/documents'
import type { TicketStatus } from '@/types/domain'
import { PropertyForm } from '@/components/properties/PropertyForm'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { HubCard } from '@/components/properties/hub/HubCard'
import { MetricStrip } from '@/components/properties/hub/MetricStrip'
import { UnitsList } from '@/components/properties/hub/UnitsList'
import { TicketsList } from '@/components/properties/hub/TicketsList'
import { FinanceSnapshot } from '@/components/properties/hub/FinanceSnapshot'
import { DocumentsList } from '@/components/properties/hub/DocumentsList'
import { formatEur } from '@/components/properties/hub/formatCurrency'
import { updatePropertyAction, archivePropertyAction } from '../actions'

// Open tickets = still needing attention. Mirrors the occupancy page + analytics
// NON_TERMINAL definition (RESOLVED/CLOSED/CANCELLED are done). Defined locally so the
// property hub stays self-contained.
const TERMINAL_TICKET_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED']

// A tenancy covers `today` when it has started and has not yet ended (open-ended =
// no end_date). Dates are ISO date strings; a lexical compare on YYYY-MM-DD is a
// correct calendar compare.
function coversToday(startDate: string, endDate: string | null, today: string): boolean {
  if (startDate > today) return false
  if (endDate && endDate < today) return false
  return true
}

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('properties:read')
  const supabase = await createClient()

  const property = await getProperty(supabase, user.workspaceId, id)
  if (!property) notFound()

  // Fetch the related data in parallel. Units/tickets/documents filter to this property;
  // tenancies + finance ledgers are workspace-wide (no property filter in the data layer)
  // and are scoped in-page to this property or its units.
  const [units, propertyTickets, tenancies, incomeRecords, expenseRecords, documents] =
    await Promise.all([
      listUnits(supabase, user.workspaceId, { propertyId: id }),
      listTickets(supabase, user.workspaceId, { propertyId: id }),
      listTenancies(supabase, user.workspaceId),
      listIncomeRecords(supabase, user.workspaceId),
      listExpenseRecords(supabase, user.workspaceId),
      listDocuments(supabase, user.workspaceId),
    ])

  const canWrite = can(user.role, 'properties:write')
  const boundUpdate = updatePropertyAction.bind(null, id)
  const boundArchive = archivePropertyAction.bind(null, id)

  // Occupancy: a unit counts occupied if a tenancy covers today OR its status is OCCUPIED.
  const today = new Date().toISOString().slice(0, 10)
  const unitIds = new Set(units.map((u) => u.id))
  const occupiedByTenancy = new Set(
    tenancies
      .filter((t) => unitIds.has(t.unit_id) && coversToday(t.start_date, t.end_date, today))
      .map((t) => t.unit_id)
  )
  const occupiedUnitIds = new Set<string>()
  for (const u of units) {
    if (u.status === 'OCCUPIED' || occupiedByTenancy.has(u.id)) occupiedUnitIds.add(u.id)
  }
  const occupancyPct =
    units.length === 0 ? 0 : Math.round((occupiedUnitIds.size / units.length) * 100)

  // Open (non-terminal) tickets for this property.
  const openTickets = propertyTickets.filter(
    (t) => !TERMINAL_TICKET_STATUSES.includes(t.status)
  )

  // Finance scoped to this property: records booked on the property OR on one of its units.
  const belongsToProperty = (rec: { property_id: string | null; unit_id: string | null }) =>
    rec.property_id === id || (rec.unit_id !== null && unitIds.has(rec.unit_id))
  const income = incomeRecords
    .filter(belongsToProperty)
    .reduce((sum, r) => sum + r.amount, 0)
  const expense = expenseRecords
    .filter(belongsToProperty)
    .reduce((sum, r) => sum + r.amount, 0)
  const net = income - expense

  // Documents attached directly to this property.
  const propertyDocuments = documents.filter((d) => d.property_id === id)

  const addressParts = [
    property.address_line1,
    property.address_line2,
    [property.postal_code, property.city].filter(Boolean).join(' '),
    property.country,
  ].filter(Boolean)

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[--duration-slow]">
      <PageHeader
        title={property.name}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge kind="entity_status" value={property.status} />
            {canWrite && property.status === 'ACTIVE' && (
              <form action={boundArchive}>
                <Button type="submit" variant="outline">
                  Archive
                </Button>
              </form>
            )}
          </div>
        }
      />

      {addressParts.length > 0 && (
        <p className="-mt-4 mb-6 flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4 shrink-0" />
          <span>{addressParts.join(', ')}</span>
        </p>
      )}

      {error && (
        <p className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-6">
        <MetricStrip
          metrics={[
            { label: 'Units', value: units.length },
            {
              label: 'Occupancy',
              value: `${occupancyPct}%`,
              hint:
                units.length > 0
                  ? `${occupiedUnitIds.size} of ${units.length} occupied`
                  : 'No units yet',
            },
            {
              label: 'Open tickets',
              value: openTickets.length,
              tone: openTickets.length > 0 ? 'negative' : 'default',
            },
            {
              label: 'Net',
              value: formatEur(net),
              tone: net < 0 ? 'negative' : net > 0 ? 'positive' : 'default',
            },
          ]}
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <HubCard
              title="Units"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link href={`/units?propertyId=${property.id}`} />}
                >
                  <DoorClosed className="size-4" />
                  View all
                </Button>
              }
            >
              <UnitsList units={units} occupiedUnitIds={occupiedUnitIds} />
            </HubCard>

            <HubCard
              title="Open tickets"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  render={<Link href={`/tickets?propertyId=${property.id}`} />}
                >
                  <Wrench className="size-4" />
                  View all
                </Button>
              }
            >
              <TicketsList tickets={openTickets} />
            </HubCard>
          </div>

          <div className="flex flex-col gap-6">
            <HubCard title="Finance snapshot">
              <FinanceSnapshot income={income} expense={expense} />
            </HubCard>

            <HubCard title="Documents">
              <DocumentsList documents={propertyDocuments} />
            </HubCard>
          </div>
        </div>

        {/* Edit details — preserved from the original detail page, still gated on
            properties:write (read-only form when the viewer cannot write). */}
        <HubCard title="Edit details">
          <PropertyForm
            action={boundUpdate}
            defaultValues={property}
            submitLabel="Save changes"
            readOnly={!canWrite}
          />
        </HubCard>
      </div>
    </div>
  )
}
