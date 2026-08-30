import { formatMoneyIn } from '@/lib/format-money'
import { redirect } from 'next/navigation'
import { Receipt } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTenantCharges, listLineItemsForInvoices } from '@/lib/data/invoices'
import { invoiceTotals, isInvoiceOverdue } from '@/lib/invoices/compute'
import { tenantInvoiceStatusLabel } from '@/lib/portal-status'
import { statusBadge } from '@/lib/status'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format-date'
import type { InvoiceLineItem, InvoiceStatus } from '@/types/domain'

export default async function PortalChargesPage() {
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()
  // Server-computed once so the overdue derivation below never drifts against a
  // client clock (same no-hidden-clock discipline as invoices/page.tsx).
  const todayIso = new Date().toISOString().slice(0, 10)

  // RLS (invoices_select_own_tenant / invoice_line_items_select_own_tenant, migration
  // 0030) narrows both reads to exactly this tenant's own OUTBOUND, non-DRAFT invoices —
  // no service client, no app-side tenant_id filter (the caller has no tenants.id to
  // filter by from this layer anyway; that lookup lives inside the RLS helper).
  const invoices = await listTenantCharges(supabase, user.workspaceId)
  const lines = await listLineItemsForInvoices(
    supabase,
    user.workspaceId,
    invoices.map((inv) => inv.id)
  )
  const linesByInvoice = new Map<string, InvoiceLineItem[]>()
  for (const line of lines) {
    const list = linesByInvoice.get(line.invoice_id)
    if (list) list.push(line)
    else linesByInvoice.set(line.invoice_id, [line])
  }

  const formatMoney = (amount: number, currency: string) => formatMoneyIn(currency, amount)

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />

      <PageHeader title="My charges" subtitle="Your invoices and payment history." />

      {invoices.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No charges yet"
          body="Invoices your property manager issues to you will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {invoices.map((inv) => {
                const total = invoiceTotals(
                  (linesByInvoice.get(inv.id) ?? []).map((l) => ({
                    quantity: l.quantity,
                    unit_amount: l.unit_amount,
                  })),
                  inv.tax_rate
                ).total
                const displayStatus: InvoiceStatus = isInvoiceOverdue(inv, todayIso)
                  ? 'OVERDUE'
                  : inv.status
                const tone = statusBadge('invoice_status', displayStatus).tone
                return (
                  <li key={inv.id} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium text-foreground">
                        {inv.invoice_number}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {inv.billing_period ? `Rent · ` : ''}
                        {formatDate(inv.issue_date)}
                        {inv.due_date && <> · Due {formatDate(inv.due_date)}</>}
                      </span>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-3">
                      <Badge variant={tone}>{tenantInvoiceStatusLabel(displayStatus)}</Badge>
                      <span className="text-sm font-medium text-foreground">
                        {formatMoney(total, inv.currency)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How to pay</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Online payment isn&apos;t available yet. Please arrange payment with your
                property manager directly (bank transfer is usually easiest) — use the
                invoice number above as your payment reference.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
