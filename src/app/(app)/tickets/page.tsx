import Link from 'next/link'
import { Ticket as TicketIcon } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { ticketStatusEnum, ticketPriorityEnum } from '@/lib/validation/ticket'
import { sortTickets, isSortColumn, type SortDir } from '@/lib/tickets/sort'
import { TicketTable } from '@/components/tickets/TicketTable'
import { TicketFilters } from '@/components/tickets/TicketFilters'
import { EmptyState } from '@/components/common/EmptyState'
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
    q?: string
    sort?: string
    dir?: string
  }>
}) {
  const user = await requirePermission('tickets:read')
  const canWrite = can(user.role, 'tickets:write')
  const {
    status: rawStatus,
    priority: rawPriority,
    propertyId: rawPropertyId,
    q,
    sort: rawSort,
    dir: rawDir,
  } = await searchParams

  // Validate enum/uuid params before passing to listTickets — a garbage ?status= or a
  // non-uuid ?propertyId= would 400 at PostgREST and crash the error boundary. Invalid
  // values are ignored (same guard as the units page's uuid check).
  const status = ticketStatusEnum.safeParse(rawStatus).success ? (rawStatus as TicketStatus) : undefined
  const priority = ticketPriorityEnum.safeParse(rawPriority).success
    ? (rawPriority as TicketPriority)
    : undefined
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined

  const sort = isSortColumn(rawSort) ? rawSort : 'created'
  const dir: SortDir = rawDir === 'asc' ? 'asc' : 'desc'

  const supabase = await createClient()
  const [tickets, properties] = await Promise.all([
    listTickets(supabase, user.workspaceId, { status, priority, propertyId, search: q }),
    listProperties(supabase, user.workspaceId),
  ])
  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))

  const sortedTickets = sortTickets(tickets, sort, dir)

  // The active filters, so column-sort links preserve them.
  const baseParams: Record<string, string> = {}
  if (status) baseParams.status = status
  if (priority) baseParams.priority = priority
  if (propertyId) baseParams.propertyId = propertyId
  if (q) baseParams.q = q

  const isFiltered = Boolean(status || priority || propertyId || q)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tickets"
        subtitle="Maintenance requests across your properties, from triage to close."
        actions={
          canWrite && <Button render={<Link href="/tickets/new" />}>New ticket</Button>
        }
      />

      <TicketFilters properties={properties.map((p) => ({ id: p.id, name: p.name }))} />

      {tickets.length === 0 ? (
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
              <Button render={<Link href="/tickets/new" />}>New ticket</Button>
            ) : undefined
          }
        />
      ) : (
        <TicketTable
          tickets={sortedTickets}
          propertyNames={propertyNames}
          sort={sort}
          dir={dir}
          baseParams={baseParams}
        />
      )}
    </div>
  )
}
