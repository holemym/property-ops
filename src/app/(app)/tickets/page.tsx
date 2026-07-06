import Link from 'next/link'
import { Search, Ticket as TicketIcon } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { ticketStatusEnum, ticketPriorityEnum } from '@/lib/validation/ticket'
import { TicketTable } from '@/components/tickets/TicketTable'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { TicketPriority, TicketStatus } from '@/types/domain'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ticketStatusEnum.options
const PRIORITIES = ticketPriorityEnum.options

const SELECT_CLASS =
  'h-8 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground'

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; propertyId?: string; q?: string }>
}) {
  const user = await requirePermission('tickets:read')
  const canWrite = can(user.role, 'tickets:write')
  const { status: rawStatus, priority: rawPriority, propertyId: rawPropertyId, q } = await searchParams

  // Validate enum/uuid params before passing to listTickets — a garbage ?status= or a
  // non-uuid ?propertyId= would 400 at PostgREST and crash the error boundary. Invalid
  // values are ignored (same guard as the units page's uuid check).
  const status = ticketStatusEnum.safeParse(rawStatus).success ? (rawStatus as TicketStatus) : undefined
  const priority = ticketPriorityEnum.safeParse(rawPriority).success
    ? (rawPriority as TicketPriority)
    : undefined
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined

  const supabase = await createClient()
  const [tickets, properties] = await Promise.all([
    listTickets(supabase, user.workspaceId, { status, priority, propertyId, search: q }),
    listProperties(supabase, user.workspaceId),
  ])
  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))

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

      <form className="flex flex-wrap items-center gap-2">
        <select name="status" defaultValue={status ?? ''} className={SELECT_CLASS}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select name="priority" defaultValue={priority ?? ''} className={SELECT_CLASS}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select name="propertyId" defaultValue={propertyId ?? ''} className={SELECT_CLASS}>
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input name="q" placeholder="Search by title" defaultValue={q ?? ''} className="pl-8" />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

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
        <TicketTable tickets={tickets} propertyNames={propertyNames} />
      )}
    </div>
  )
}
