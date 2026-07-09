import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil, Mail } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getInvoice, listInvoiceLines } from '@/lib/data/invoices'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor } from '@/lib/data/vendors'
import { getTicket } from '@/lib/data/tickets'
import { invoiceTotals } from '@/lib/invoices/compute'
import { StatusBadge, Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ErrorToast } from '@/components/common/ErrorToast'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { InvoiceStatusActions } from '@/components/invoices/InvoiceStatusActions'
import { InvoicePrint, PrintInvoiceButton } from '@/components/invoices/InvoicePrint'
import { SentToast } from '@/components/invoices/SentToast'
import { formatDate } from '@/lib/format-date'
import { setInvoiceStatusAction, sendInvoiceAction } from '../actions'

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  )
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ sent?: string }>
}) {
  const { id } = await params
  const { sent } = await searchParams
  const user = await requirePermission('finance:read')
  const canWrite = can(user.role, 'finance:write')

  const supabase = await createClient()
  const invoice = await getInvoice(supabase, user.workspaceId, id)
  if (!invoice) notFound()

  const [lines, property, unit, vendor, ticket] = await Promise.all([
    listInvoiceLines(supabase, user.workspaceId, id),
    invoice.property_id ? getProperty(supabase, user.workspaceId, invoice.property_id) : Promise.resolve(null),
    invoice.unit_id ? getUnit(supabase, user.workspaceId, invoice.unit_id) : Promise.resolve(null),
    invoice.vendor_id ? getVendor(supabase, user.workspaceId, invoice.vendor_id) : Promise.resolve(null),
    invoice.ticket_id ? getTicket(supabase, user.workspaceId, invoice.ticket_id) : Promise.resolve(null),
  ])

  const totals = invoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_amount: l.unit_amount })),
    invoice.tax_rate,
  )
  const fmt = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: invoice.currency || 'EUR',
  })

  const boundSetStatus = setInvoiceStatusAction.bind(null, id)
  const boundSend = sendInvoiceAction.bind(null, id)

  const hasLinks = property || unit || vendor || ticket || invoice.tenancy_id

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      {sent && <SentToast />}

      {/* Print layout (hidden on screen, shown on paper). */}
      <InvoicePrint invoice={invoice} lines={lines} />

      {/* Everything below is `print:hidden` so paper shows only the print layout. */}
      <div className="flex flex-col gap-6 print:hidden">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <Link href="/invoices" className="w-fit text-sm text-muted-foreground hover:text-foreground">
            ← Invoices
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold tracking-tight tabular-nums">
                {invoice.invoice_number}
              </h1>
              <StatusBadge kind="invoice_status" value={invoice.status} />
              <Badge variant="outline" className="capitalize">
                {invoice.party_type.toLowerCase()}
              </Badge>
              <Badge variant="outline" className="capitalize">
                {invoice.direction.toLowerCase()}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <PrintInvoiceButton />
              {canWrite && invoice.status !== 'VOID' && (
                <form action={boundSend}>
                  <SubmitButton variant="outline" size="sm" pendingLabel="Sending">
                    <Mail className="size-4" />
                    Send
                  </SubmitButton>
                </form>
              )}
              {canWrite && (
                <Button variant="outline" size="sm" render={<Link href={`/invoices/${id}/edit`} />}>
                  <Pencil className="size-4" />
                  Edit
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: summary + lines */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <SummaryField label="Party">{invoice.party_name}</SummaryField>
                  <SummaryField label="Issue date">{formatDate(invoice.issue_date)}</SummaryField>
                  <SummaryField label="Due date">
                    {invoice.due_date ? formatDate(invoice.due_date) : '—'}
                  </SummaryField>
                  <SummaryField label="Recipient email">
                    {invoice.recipient_email || <span className="text-muted-foreground">Not set</span>}
                  </SummaryField>
                  {invoice.paid_at && (
                    <SummaryField label="Paid at">
                      {new Date(invoice.paid_at).toLocaleString()}
                    </SummaryField>
                  )}
                  {invoice.notes && (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        Notes
                      </dt>
                      <dd className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                        {invoice.notes}
                      </dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Line items</CardTitle>
              </CardHeader>
              <CardContent>
                {lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This invoice has no line items.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="px-4">Description</TableHead>
                          <TableHead className="px-4 text-right">Qty</TableHead>
                          <TableHead className="px-4 text-right">Unit amount</TableHead>
                          <TableHead className="px-4 text-right">Amount</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell className="px-4 py-3">{l.description}</TableCell>
                            <TableCell className="px-4 py-3 text-right tabular-nums">
                              {l.quantity}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-right tabular-nums">
                              {fmt.format(l.unit_amount)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-right font-medium tabular-nums">
                              {fmt.format(l.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* Totals */}
                <div className="ml-auto mt-4 flex w-full max-w-xs flex-col gap-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{fmt.format(totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tax ({invoice.tax_rate}%)</span>
                    <span className="tabular-nums">{fmt.format(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total</span>
                    <span className="tabular-nums">{fmt.format(totals.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: status actions + linked records */}
          <div className="flex flex-col gap-6">
            {canWrite && (
              <Card>
                <CardHeader>
                  <CardTitle>Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <InvoiceStatusActions invoice={invoice} action={boundSetStatus} />
                </CardContent>
              </Card>
            )}

            {hasLinks && (
              <Card>
                <CardHeader>
                  <CardTitle>Linked records</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-4">
                    {property && (
                      <SummaryField label="Property">
                        <Link
                          href={`/properties/${property.id}`}
                          className="underline underline-offset-2"
                        >
                          {property.name}
                        </Link>
                      </SummaryField>
                    )}
                    {unit && (
                      <SummaryField label="Unit">
                        <Link href={`/units/${unit.id}`} className="underline underline-offset-2">
                          {unit.label}
                        </Link>
                      </SummaryField>
                    )}
                    {vendor && (
                      <SummaryField label="Vendor">
                        <Link href={`/vendors/${vendor.id}`} className="underline underline-offset-2">
                          {vendor.company_name}
                        </Link>
                      </SummaryField>
                    )}
                    {ticket && (
                      <SummaryField label="Ticket">
                        <Link href={`/tickets/${ticket.id}`} className="underline underline-offset-2">
                          {ticket.title}
                        </Link>
                      </SummaryField>
                    )}
                    {invoice.tenancy_id && !property && !unit && !vendor && !ticket && (
                      <SummaryField label="Tenancy">Linked tenancy</SummaryField>
                    )}
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
