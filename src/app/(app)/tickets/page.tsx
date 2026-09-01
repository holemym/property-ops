import Link from 'next/link'
import { Plus, Ticket as TicketIcon } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTicketsPage } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { ticketStatusEnum, ticketPriorityEnum } from '@/lib/validation/ticket'
import { isSortColumn, TICKET_DB_COLUMN, type SortDir } from '@/lib/tickets/sort'
import { TicketTable } from '@/components/tickets/TicketTable'
import { TicketFilters } from '@/components/tickets/TicketFilters'
import { EmptyState } from '@/components/common/EmptyState'
import { Pagination } from '@/components/common/Pagination'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import type { TicketPriority, TicketStatus } from '@/types/domain'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    priority?: string
    propertyId?: string
    unitId?: string
    q?: string
    sort?: string
    dir?: string
    page?: string
  }>
}) {
  const user = await requirePermission('tickets:read')
  const canWrite = can(user.role, 'tickets:write')
  const {
    status: rawStatus,
    priority: rawPriority,
    propertyId: rawPropertyId,
    unitId: rawUnitId,
    q,
    sort: rawSort,
    dir: rawDir,
    page: rawPage,
  } = await searchParams

  // Validate enum/uuid params before passing to listTickets — a garbage ?status= or a
  // non-uuid ?propertyId= would 400 at PostgREST and crash the error boundary. Invalid
  // values are ignored (same guard as the units page's uuid check).
  const status = ticketStatusEnum.safeParse(rawStatus).success ? (rawStatus as TicketStatus) : undefined
  const priority = ticketPriorityEnum.safeParse(rawPriority).success
    ? (rawPriority as TicketPriority)
    : undefined
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined
  const unitId = rawUnitId && UUID_RE.test(rawUnitId) ? rawUnitId : undefined

  const sort = isSortColumn(rawSort) ? rawSort : 'created'
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc'
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)

  const supabase = await createClient()
  // Tickets are DB-sorted + paged (bounded query + payload); properties feed the filter
  // select (small set, fetched whole).
  const [ticketPage, properties, scopedUnit] = await Promise.all([
    listTicketsPage(supabase, user.workspaceId, {
      filters: { status, priority, propertyId, unitId, search: q },
      orderBy: TICKET_DB_COLUMN[sort],
      ascending: dir === 'asc',
      page: requestedPage,
    }),
    listProperties(supabase, user.workspaceId),
    // The unit-scope chip's label (unit pages link here with ?unitId=). Only fetched
    // when the filter is set; a stale/foreign id resolves null and the chip degrades.
    unitId ? getUnit(supabase, user.workspaceId, unitId) : Promise.resolve(null),
  ])
  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))

  // The active filters, so column-sort links preserve them (sort links reset to page 1 by
  // omitting page). Pagination additionally preserves the current sort.
  const filterParams: Record<string, string> = {}
  if (status) filterParams.status = status
  if (priority) filterParams.priority = priority
  if (propertyId) filterParams.propertyId = propertyId
  if (unitId) filterParams.unitId = unitId
  if (q) filterParams.q = q

  const isFiltered = Boolean(status || priority || propertyId || unitId || q)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tickets"
        subtitle="Maintenance requests across your properties, from triage to close."
        actions={
          canWrite && (
            <Button render={<Link href="/tickets/new" />} nativeButton={false}>
              <Plus className="size-4" />
              New ticket
            </Button>
          )
        }
      />

      <TicketFilters
        properties={properties.map((p) => ({ id: p.id, name: p.name }))}
        unitLabel={scopedUnit?.label}
      />

      {ticketPage.total === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title={isFiltered ? 'No matching tickets' : 'No tickets yet'}
          body={
            isFiltered
              ? 'Adjust the filters or clear them to see every ticket.'
              : 'Open a ticket to track a repair, and it will show up here through to close.'
          }
          action={
            canWrite && !isFiltered ? (
              <Button render={<Link href="/tickets/new" />} nativeButton={false}>
                <Plus className="size-4" />
                New ticket
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <TicketTable
            tickets={ticketPage.rows}
            propertyNames={propertyNames}
            sort={sort}
            dir={dir}
            baseParams={filterParams}
          />
          <Pagination
            page={ticketPage.page}
            pageCount={ticketPage.pageCount}
            total={ticketPage.total}
            baseParams={{ ...filterParams, sort, dir }}
            basePath="/tickets"
          />
        </div>
      )}
    </div>
  )
}
