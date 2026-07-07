import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { relativeDay } from '@/lib/relative-date'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketPriority } from '@/types/domain'

// A left color-spine so urgency reads at a glance while scanning the list — red for
// URGENT, amber for HIGH, transparent (keeps alignment) otherwise.
const PRIORITY_SPINE: Record<TicketPriority, string> = {
  URGENT: 'border-l-red-500',
  HIGH: 'border-l-amber-500',
  NORMAL: 'border-l-transparent',
  LOW: 'border-l-transparent',
}

// listTickets returns raw rows (property_id, not a joined property name), so the page
// fetches properties once and passes an id->name map. The Property column reads from it,
// falling back to an em dash if a name is missing (e.g. a since-archived/removed row).
//
// Rows are clickable to the ticket detail page: the title cell holds a stretched Link
// (after:absolute inset-0) so the whole row navigates without client JS, mirroring the
// PropertyTable pattern. Status + priority use the shared StatusBadge (the only sanctioned
// colored-pill), which sit in `relative z-10` cells so their tone is legible above the
// stretched link overlay.
export function TicketTable({
  tickets,
  propertyNames,
}: {
  tickets: Ticket[]
  propertyNames: Record<string, string>
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Title</TableHead>
            <TableHead className="px-4">Property</TableHead>
            <TableHead className="px-4">Category</TableHead>
            <TableHead className="px-4">Priority</TableHead>
            <TableHead className="px-4">Status</TableHead>
            <TableHead className="px-4">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tickets.map((t) => (
            <TableRow
              key={t.id}
              className={cn('group relative cursor-pointer border-l-2', PRIORITY_SPINE[t.priority])}
            >
              <TableCell className="px-4 py-3 font-medium">
                <Link
                  href={`/tickets/${t.id}`}
                  className="after:absolute after:inset-0 group-hover:underline"
                >
                  {t.title}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {propertyNames[t.property_id] ?? '—'}
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground capitalize">
                {t.category.replace(/_/g, ' ').toLowerCase()}
              </TableCell>
              <TableCell className="relative z-10 px-4 py-3">
                <StatusBadge kind="ticket_priority" value={t.priority} />
              </TableCell>
              <TableCell className="relative z-10 px-4 py-3">
                <StatusBadge kind="ticket_status" value={t.status} />
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                <span title={new Date(t.created_at).toLocaleString()}>
                  {relativeDay(t.created_at)}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
