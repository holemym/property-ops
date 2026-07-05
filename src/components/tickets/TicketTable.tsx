import Link from 'next/link'
import { DataTable, type Column } from '@/components/common/DataTable'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/tickets/TicketBadges'
import type { Ticket } from '@/lib/data/tickets'

// listTickets returns raw rows (property_id, not a joined property name), so the page
// fetches properties once and passes an id->name map. The Property column reads from it,
// falling back to an em dash if a name is missing (e.g. a since-archived/removed row).
export function TicketTable({
  tickets,
  propertyNames,
}: {
  tickets: Ticket[]
  propertyNames: Record<string, string>
}) {
  const columns: Column<Ticket>[] = [
    {
      header: 'Title',
      cell: (t) => (
        <Link href={`/tickets/${t.id}`} className="font-medium hover:underline">
          {t.title}
        </Link>
      ),
    },
    { header: 'Property', cell: (t) => propertyNames[t.property_id] ?? '—' },
    { header: 'Category', cell: (t) => t.category.replace(/_/g, ' ') },
    { header: 'Priority', cell: (t) => <TicketPriorityBadge priority={t.priority} /> },
    { header: 'Status', cell: (t) => <TicketStatusBadge status={t.status} /> },
    { header: 'Created', cell: (t) => new Date(t.created_at).toLocaleDateString() },
  ]

  return <DataTable columns={columns} rows={tickets} />
}
