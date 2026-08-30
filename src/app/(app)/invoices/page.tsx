import { formatMoneyIn } from '@/lib/format-money'
import Link from 'next/link'
import { ReceiptText, Download, Plus } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listInvoicesPage, listLineItemsForInvoices } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import {
  invoiceStatusEnum,
  invoicePartyTypeEnum,
  invoiceDirectionEnum,
} from '@/lib/validation/invoice'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Pagination } from '@/components/common/Pagination'
import { Button } from '@/components/ui/button'
import { InvoiceTable } from '@/components/invoices/InvoiceTable'
import { InvoiceFilters } from '@/components/invoices/InvoiceFilters'
import { GenerateRentDialog } from '@/components/invoices/GenerateRentDialog'
import { GeneratedToast } from '@/components/invoices/GeneratedToast'
import { generateRentInvoicesAction } from './actions'
import type { InvoiceStatus, InvoicePartyType, InvoiceDirection, InvoiceLineItem } from '@/types/domain'

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    partyType?: string
    direction?: string
    propertyId?: string
    page?: string
    overdue?: string
    generated?: string
    skipped?: string
  }>
}) {
  const user = await requirePermission('finance:read')
  const canWrite = can(user.role, 'finance:write')
  const {
    status: rawStatus,
    partyType: rawPartyType,
    direction: rawDirection,
    propertyId: rawPropertyId,
    page: rawPage,
    overdue: rawOverdue,
    generated: rawGenerated,
    skipped: rawSkipped,
  } = await searchParams

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
  const overdue = rawOverdue === '1'
  // UUID-guarded like the tickets page — feeds the property hub's "View invoices" link.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined

  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)
  // Server-computed so the "Generate rent" dialog's month default and the overdue badge
  // derivation agree on the same instant — no client-side new Date() (avoids any
  // SSR/hydration clock skew) and matches the house todayIso pattern (occupancy/page.tsx,
  // properties/[id]/page.tsx).
  const todayIso = new Date().toISOString().slice(0, 10)

  const supabase = await createClient()
  const invoicePage = await listInvoicesPage(supabase, user.workspaceId, {
    filters: { status, partyType, direction, propertyId, overdue },
    page: requestedPage,
  })
  const invoices = invoicePage.rows
  // Fetch line items for THIS PAGE's invoices only, then compute each total in JS via
  // invoiceTotals. Currency is per-invoice; totals display in the invoice's own currency.
  const pageLines = await listLineItemsForInvoices(
    supabase,
    user.workspaceId,
    invoices.map((inv) => inv.id),
  )
  const linesByInvoice = new Map<string, InvoiceLineItem[]>()
  for (const line of pageLines) {
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
    totalStringById.set(inv.id, formatMoneyIn(inv.currency, total))
  }
  const totalFor = (id: string) => totalStringById.get(id) ?? formatMoneyIn('EUR', 0)

  const isFiltered = Boolean(status || partyType || direction || overdue)

  // Carry the CURRENT filters onto the export link so the CSV matches what's on screen.
  const exportParams = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(partyType ? { partyType } : {}),
    ...(direction ? { direction } : {}),
  }).toString()
  const exportHref = exportParams ? `/invoices/export?${exportParams}` : '/invoices/export'

  const exportButton = (
    <Button variant="outline" render={<Link href={exportHref} />} nativeButton={false}>
      <Download className="size-4" />
      Export CSV
    </Button>
  )
  const newButton = canWrite ? (
    <Button render={<Link href="/invoices/new" />} nativeButton={false}>
      <Plus className="size-4" />
      New invoice
    </Button>
  ) : null
  const generateRentButton = canWrite ? (
    <GenerateRentDialog action={generateRentInvoicesAction} defaultMonth={todayIso.slice(0, 7)} />
  ) : null
  const headerActions = (
    <div className="flex items-center gap-2">
      {exportButton}
      {generateRentButton}
      {newButton}
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      {rawGenerated !== undefined && (
        <GeneratedToast
          generated={Number.parseInt(rawGenerated, 10) || 0}
          skipped={Number.parseInt(rawSkipped ?? '0', 10) || 0}
        />
      )}
      <PageHeader
        title="Invoices"
        subtitle="Bills you send and bills you receive, across the portfolio."
        actions={headerActions}
      />

      <InvoiceFilters />

      {invoicePage.total === 0 ? (
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
        <div className="flex flex-col gap-4">
          <InvoiceTable invoices={invoices} totalFor={totalFor} todayIso={todayIso} />
          <Pagination
            page={invoicePage.page}
            pageCount={invoicePage.pageCount}
            total={invoicePage.total}
            baseParams={{
              ...(status ? { status } : {}),
              ...(partyType ? { partyType } : {}),
              ...(direction ? { direction } : {}),
              ...(overdue ? { overdue: '1' } : {}),
            }}
            basePath="/invoices"
          />
        </div>
      )}
    </div>
  )
}
