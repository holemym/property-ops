import Link from 'next/link'
import { ChevronRight, Wrench } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import type { Ticket } from '@/lib/data/tickets'

// Open (non-terminal) tickets for this property. Each row links to /tickets/[id] and
// carries a priority + status pill. EmptyState (calm, no error tone) when there is
// nothing open. Self-contained.
export function TicketsList({ tickets }: { tickets: Ticket[] }) {
  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<Wrench />}
        title="No open tickets"
        body="Maintenance and issue tickets for this property will appear here while they are open."
      />
    )
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {tickets.map((t) => (
        <li key={t.id}>
          <Link
            href={`/tickets/${t.id}`}
            className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{t.title}</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="ticket_priority" value={t.priority} />
                <StatusBadge kind="ticket_status" value={t.status} />
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
