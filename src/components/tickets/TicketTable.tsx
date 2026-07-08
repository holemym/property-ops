import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
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
import type { SortColumn, SortDir } from '@/lib/tickets/sort'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketPriority } from '@/types/domain'

// A clickable sort header. Clicking the active column flips direction; clicking a new one
// starts at its natural default (newest / most-urgent first for date & priority, else A→Z).
function SortableHead({
  column,
  label,
  sort,
  dir,
  baseParams,
  align = 'left',
}: {
  column: SortColumn
  label: string
  sort: SortColumn
  dir: SortDir
  baseParams: Record<string, string>
  align?: 'left' | 'right'
}) {
  const active = sort === column
  const defaultDir: SortDir = column === 'created' || column === 'priority' ? 'desc' : 'asc'
  const nextDir: SortDir = active ? (dir === 'asc' ? 'desc' : 'asc') : defaultDir
  const params = new URLSearchParams({ ...baseParams, sort: column, dir: nextDir })
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ChevronsUpDown
  return (
    <TableHead className="px-4">
      <Link
        href={`/tickets?${params.toString()}`}
        className={cn(
          'group inline-flex items-center gap-1 transition-colors hover:text-foreground',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
        aria-label={`Sort by ${label}${active ? (dir === 'asc' ? ', ascending' : ', descending') : ''}`}
      >
        {label}
        <Icon className={cn('size-3.5', active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70')} />
      </Link>
    </TableHead>
  )
}

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
  sort,
  dir,
  baseParams,
}: {
  tickets: Ticket[]
  propertyNames: Record<string, string>
  sort: SortColumn
  dir: SortDir
  baseParams: Record<string, string>
}) {
  const headProps = { sort, dir, baseParams }
  return (
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {tickets.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tickets/${t.id}`}
              className={cn(
                'flex flex-col gap-2 rounded-lg border border-l-2 bg-card p-3',
                PRIORITY_SPINE[t.priority],
              )}
            >
              <span className="font-medium leading-snug">{t.title}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="ticket_priority" value={t.priority} />
                <StatusBadge kind="ticket_status" value={t.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate capitalize">
                  {(propertyNames[t.property_id] ?? '—') +
                    ' · ' +
                    t.category.replace(/_/g, ' ').toLowerCase()}
                </span>
                <span className="shrink-0" title={new Date(t.created_at).toLocaleString()}>
                  {relativeDay(t.created_at)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: the full sortable table. */}
      <div className="hidden overflow-hidden rounded-lg border sm:block">
        <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <SortableHead column="title" label="Title" {...headProps} />
            <TableHead className="px-4">Property</TableHead>
            <TableHead className="px-4">Category</TableHead>
            <SortableHead column="priority" label="Priority" {...headProps} />
            <SortableHead column="status" label="Status" {...headProps} />
            <SortableHead column="created" label="Created" {...headProps} />
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
    </>
  )
}
