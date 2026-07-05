import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { ticketStatusEnum, ticketPriorityEnum } from '@/lib/validation/ticket'
import { TicketTable } from '@/components/tickets/TicketTable'
import { EmptyState } from '@/components/common/EmptyState'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { TicketPriority, TicketStatus } from '@/types/domain'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ticketStatusEnum.options
const PRIORITIES = ticketPriorityEnum.options

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tickets</h1>
        {canWrite && <Button render={<Link href="/tickets/new" />}>New ticket</Button>}
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <select
          name="status"
          defaultValue={status ?? ''}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={priority ?? ''}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          name="propertyId"
          defaultValue={propertyId ?? ''}
          className="h-9 rounded-md border px-2 text-sm"
        >
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Input name="q" placeholder="Search title..." defaultValue={q ?? ''} className="max-w-xs" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {tickets.length === 0 ? (
        <EmptyState
          title="No tickets yet"
          description="Tickets you create or that tenants report will appear here."
          actionLabel={canWrite ? 'New ticket' : undefined}
          actionHref={canWrite ? '/tickets/new' : undefined}
        />
      ) : (
        <TicketTable tickets={tickets} propertyNames={propertyNames} />
      )}
    </div>
  )
}
