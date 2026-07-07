import Link from 'next/link'
import { ReceiptText } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listInvoices, listLineItemsForWorkspace } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import {
  invoiceStatusEnum,
  invoicePartyTypeEnum,
  invoiceDirectionEnum,
} from '@/lib/validation/invoice'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Button } from '@/components/ui/button'
import { InvoiceTable } from '@/components/invoices/InvoiceTable'
import { InvoiceFilters } from '@/components/invoices/InvoiceFilters'
import type { InvoiceStatus, InvoicePartyType, InvoiceDirection, InvoiceLineItem } from '@/types/domain'

const money = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; partyType?: string; direction?: string }>
}) {
  const user = await requirePermission('finance:read')
  const canWrite = can(user.role, 'finance:write')
  const { status: rawStatus, partyType: rawPartyType, direction: rawDirection } = await searchParams

  // Validate enum params before passing to listInvoices — a garbage ?status= would 400 at
  // PostgREST and crash the error boundary. Invalid values are ignored (same guard as the
  // tickets page).
  const status = invoiceStatusEnum.safeParse(rawStatus).success ? (rawStatus as InvoiceStatus) : undefined
  const partyType = invoicePartyTypeEnum.safeParse(rawPartyType).success
    ? (rawPartyType as InvoicePartyType)
    : undefined
  const direction = invoiceDirectionEnum.safeParse(rawDirection).success
    ? (rawDirection as InvoiceDirection)
    : undefined

  const supabase = await createClient()
  const [invoices, allLines] = await Promise.all([
    listInvoices(supabase, user.workspaceId, { status, partyType, direction }),
    listLineItemsForWorkspace(supabase, user.workspaceId),
  ])

  // Group the workspace's line items by invoice_id once, then compute each invoice's total in
  // JS via invoiceTotals (one round-trip instead of N per-invoice queries). Currency is
  // per-invoice; we display totals in the invoice's own currency below.
  const linesByInvoice = new Map<string, InvoiceLineItem[]>()
  for (const line of allLines) {
    const list = linesByInvoice.get(line.invoice_id)
    if (list) list.push(line)
    else linesByInvoice.set(line.invoice_id, [line])
  }

  const totalStringById = new Map<string, string>()
  for (const inv of invoices) {
    const lines = linesByInvoice.get(inv.id) ?? []
    const { total } = invoiceTotals(
      lines.map((l) => ({ quantity: l.quantity, unit_amount: l.unit_amount })),
      inv.tax_rate,
    )
    const fmt =
      inv.currency && inv.currency !== 'EUR'
        ? new Intl.NumberFormat('en-IE', { style: 'currency', currency: inv.currency })
        : money
    totalStringById.set(inv.id, fmt.format(total))
  }
  const totalFor = (id: string) => totalStringById.get(id) ?? money.format(0)

  const isFiltered = Boolean(status || partyType || direction)
  const newButton = canWrite ? <Button render={<Link href="/invoices/new" />}>New invoice</Button> : null

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader
        title="Invoices"
        subtitle="Bills you send and bills you receive, across the portfolio."
        actions={newButton ?? undefined}
      />

      <InvoiceFilters />

      {invoices.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title={isFiltered ? 'No matching invoices' : 'No invoices yet'}
          body={
            isFiltered
              ? 'Adjust the filters or clear them to see every invoice.'
              : canWrite
                ? 'Create an invoice to bill an owner, tenant, or vendor, and it will show up here.'
                : 'Once managers raise invoices, they appear here with their status and totals.'
          }
          action={canWrite && !isFiltered ? newButton ?? undefined : undefined}
        />
      ) : (
        <InvoiceTable invoices={invoices} totalFor={totalFor} />
      )}
    </div>
  )
}
