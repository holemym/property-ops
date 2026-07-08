import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge, StatusBadge } from '@/components/ui/badge'
import type { Invoice } from '@/types/domain'

// The invoices list table (server component). The page computes each invoice's total in JS
// (grouping the workspace's line items by invoice_id) and passes a totals map keyed by id,
// plus a per-row formatted total string — this table stays presentational.
//
// Rows are clickable to the detail page via a stretched Link on the number cell
// (after:absolute inset-0), mirroring TicketTable. The status pill sits in a `relative z-10`
// cell so it's legible/clickable above the stretched overlay. Party type renders as a plain
// outline Badge (there is no colored party badge — saturated color is reserved for status).
export function InvoiceTable({
  invoices,
  totalFor,
}: {
  invoices: Invoice[]
  totalFor: (id: string) => string
}) {
  return (
    <>
      {/* Mobile: stacked cards. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {invoices.map((inv) => (
          <li key={inv.id}>
            <Link
              href={`/invoices/${inv.id}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium tabular-nums">{inv.invoice_number}</span>
                <span className="font-medium tabular-nums">{totalFor(inv.id)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="min-w-0 truncate">{inv.party_name}</span>
                <Badge variant="outline" className="capitalize">
                  {inv.party_type.toLowerCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <StatusBadge kind="invoice_status" value={inv.status} />
                <span>
                  {new Date(inv.issue_date).toLocaleDateString()}
                  {inv.due_date ? ` · due ${new Date(inv.due_date).toLocaleDateString()}` : ''}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: table. */}
      <div className="hidden overflow-hidden rounded-lg border sm:block">
        <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Number</TableHead>
            <TableHead className="px-4">Party</TableHead>
            <TableHead className="px-4">Status</TableHead>
            <TableHead className="px-4">Issued</TableHead>
            <TableHead className="px-4">Due</TableHead>
            <TableHead className="px-4 text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id} className="group relative cursor-pointer">
              <TableCell className="px-4 py-3 font-medium tabular-nums">
                <Link
                  href={`/invoices/${inv.id}`}
                  className="after:absolute after:inset-0 group-hover:underline"
                >
                  {inv.invoice_number}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3">
                <div className="relative z-10 flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{inv.party_name}</span>
                  <Badge variant="outline" className="capitalize">
                    {inv.party_type.toLowerCase()}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="relative z-10 px-4 py-3">
                <StatusBadge kind="invoice_status" value={inv.status} />
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {new Date(inv.issue_date).toLocaleDateString()}
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}
              </TableCell>
              <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                {totalFor(inv.id)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        </Table>
      </div>
    </>
  )
}
