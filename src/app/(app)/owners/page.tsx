import Link from 'next/link'
import { Users } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listInvoices, listLineItemsForWorkspace } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import { summarizeOwners, type OwnerInvoiceRow } from '@/lib/invoices/owners'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

// Owner statements — a per-owner rollup of the invoices billed to them (party_type OWNER).
// Finance-gated read, same audience as invoices/finance. An "owner" is a distinct party
// name (no separate owner entity in the MVP).
export default async function OwnersPage() {
  const user = await requirePermission('finance:read')
  const supabase = await createClient()

  const [invoices, lineItems] = await Promise.all([
    listInvoices(supabase, user.workspaceId, { partyType: 'OWNER' }),
    listLineItemsForWorkspace(supabase, user.workspaceId),
  ])

  // Per-invoice total from its lines + tax.
  const linesByInvoice = new Map<string, { quantity: number; unit_amount: number }[]>()
  for (const l of lineItems) {
    const list = linesByInvoice.get(l.invoice_id)
    if (list) list.push(l)
    else linesByInvoice.set(l.invoice_id, [l])
  }
  const rows: OwnerInvoiceRow[] = invoices.map((inv) => ({
    name: inv.party_name,
    total: invoiceTotals(linesByInvoice.get(inv.id) ?? [], inv.tax_rate).total,
    status: inv.status,
  }))
  const owners = summarizeOwners(rows)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Owners"
        subtitle="Statements for each property owner you invoice, with amounts billed and outstanding."
      />

      {owners.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No owner statements yet"
          body="Create an invoice with the party set to an owner, and each owner's statement will appear here."
        />
      ) : (
        <>
        {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {owners.map((o) => (
            <li key={o.name}>
              <Link
                href={`/owners/${encodeURIComponent(o.name)}`}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium leading-snug">{o.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {o.invoiceCount} {o.invoiceCount === 1 ? 'invoice' : 'invoices'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    Billed {eur.format(o.billed)} · Paid {eur.format(o.paid)}
                  </span>
                  <span
                    className={
                      o.outstanding > 0
                        ? 'shrink-0 font-medium tabular-nums text-amber-700 dark:text-amber-400'
                        : 'shrink-0 tabular-nums'
                    }
                  >
                    {eur.format(o.outstanding)} due
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>

        {/* Desktop: the full table. */}
        <div className="hidden overflow-hidden rounded-lg border sm:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="px-4">Owner</TableHead>
                <TableHead className="px-4 text-right">Invoices</TableHead>
                <TableHead className="px-4 text-right">Billed</TableHead>
                <TableHead className="px-4 text-right">Paid</TableHead>
                <TableHead className="px-4 text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o) => (
                <TableRow key={o.name} className="group relative cursor-pointer">
                  <TableCell className="px-4 py-3 font-medium">
                    <Link
                      href={`/owners/${encodeURIComponent(o.name)}`}
                      className="after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                    >
                      {o.name}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {o.invoiceCount}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums">{eur.format(o.billed)}</TableCell>
                  <TableCell className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {eur.format(o.paid)}
                  </TableCell>
                  <TableCell
                    className={
                      o.outstanding > 0
                        ? 'px-4 py-3 text-right font-medium tabular-nums text-amber-700 dark:text-amber-400'
                        : 'px-4 py-3 text-right tabular-nums text-muted-foreground'
                    }
                  >
                    {eur.format(o.outstanding)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        </>
      )}
    </div>
  )
}
