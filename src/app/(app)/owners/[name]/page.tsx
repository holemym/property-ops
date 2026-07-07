import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listInvoices, listLineItemsForWorkspace } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import { summarizeOwners, type OwnerInvoiceRow } from '@/lib/invoices/owners'
import { StatusBadge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  OwnerStatementPrint,
  PrintStatementButton,
  type StatementLine,
} from '@/components/invoices/OwnerStatementPrint'

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })
}

// One owner's statement — every invoice billed to them, with billed / paid / outstanding
// and a printable version. Finance-gated. The owner is keyed by party name (URL-encoded).
export default async function OwnerStatementPage({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const { name: rawName } = await params
  const name = decodeURIComponent(rawName)
  const user = await requirePermission('finance:read')
  const supabase = await createClient()

  const [invoices, lineItems] = await Promise.all([
    listInvoices(supabase, user.workspaceId, { partyType: 'OWNER' }),
    listLineItemsForWorkspace(supabase, user.workspaceId),
  ])

  const owned = invoices.filter((inv) => inv.party_name === name)
  if (owned.length === 0) notFound()

  const linesByInvoice = new Map<string, { quantity: number; unit_amount: number }[]>()
  for (const l of lineItems) {
    const list = linesByInvoice.get(l.invoice_id)
    if (list) list.push(l)
    else linesByInvoice.set(l.invoice_id, [l])
  }
  const totalFor = (id: string, taxRate: number) =>
    invoiceTotals(linesByInvoice.get(id) ?? [], taxRate).total

  const rows: OwnerInvoiceRow[] = owned.map((inv) => ({
    name: inv.party_name,
    total: totalFor(inv.id, inv.tax_rate),
    status: inv.status,
  }))
  const summary = summarizeOwners(rows)[0]

  const statementLines: StatementLine[] = owned
    .slice()
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))
    .map((inv) => ({
      id: inv.id,
      number: inv.invoice_number,
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      status: inv.status,
      total: totalFor(inv.id, inv.tax_rate),
    }))

  return (
    <>
    <div className="flex flex-col gap-6 print:hidden">
      <Link
        href="/owners"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Owners
      </Link>

      <PageHeader title={name} subtitle="Owner statement" actions={<PrintStatementButton />} />

      {/* Summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Billed" value={eur.format(summary.billed)} />
        <SummaryCard label="Paid" value={eur.format(summary.paid)} muted />
        <SummaryCard
          label="Outstanding"
          value={eur.format(summary.outstanding)}
          tone={summary.outstanding > 0 ? 'amber' : undefined}
        />
      </div>

      {/* Invoices */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="px-4">Invoice</TableHead>
              <TableHead className="px-4">Issued</TableHead>
              <TableHead className="px-4">Due</TableHead>
              <TableHead className="px-4">Status</TableHead>
              <TableHead className="px-4 text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statementLines.map((l) => (
              <TableRow key={l.id} className="group relative cursor-pointer">
                <TableCell className="px-4 py-3 font-medium tabular-nums">
                  <Link
                    href={`/invoices/${l.id}`}
                    className="after:absolute after:inset-0 group-hover:underline"
                  >
                    {l.number}
                  </Link>
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">{formatDate(l.issueDate)}</TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {l.dueDate ? formatDate(l.dueDate) : '—'}
                </TableCell>
                <TableCell className="relative z-10 px-4 py-3">
                  <StatusBadge kind="invoice_status" value={l.status} />
                </TableCell>
                <TableCell className="px-4 py-3 text-right tabular-nums">{eur.format(l.total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>

    {/* Print-only layout — a sibling OUTSIDE the print:hidden wrapper so it survives print. */}
    <OwnerStatementPrint
      ownerName={name}
      lines={statementLines}
      billed={summary.billed}
      paid={summary.paid}
      outstanding={summary.outstanding}
    />
    </>
  )
}

function SummaryCard({
  label,
  value,
  muted,
  tone,
}: {
  label: string
  value: string
  muted?: boolean
  tone?: 'amber'
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span
          className={
            tone === 'amber'
              ? 'text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-400'
              : muted
                ? 'text-2xl font-semibold tabular-nums text-muted-foreground'
                : 'text-2xl font-semibold tabular-nums text-foreground'
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  )
}
