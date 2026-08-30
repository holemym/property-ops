'use client'

import { formatMoneyIn } from '@/lib/format-money'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { invoiceTotals } from '@/lib/invoices/compute'
import { formatDateLong } from '@/lib/format-date'
import type { Invoice, InvoiceLineItem } from '@/types/domain'

// Print-friendly invoice. Two pieces, both client (this file owns the window.print() call):
//   - <PrintInvoiceButton>: a tiny button that triggers the browser print dialog.
//   - <InvoicePrint>: a clean, letterhead-ish invoice laid out for paper.
//
// The print layout is HIDDEN on screen (`hidden print:block`) and the rest of the app chrome
// is hidden on paper via a global `@media print` rule that hides everything except the print
// root (see the print:block/print:hidden usage on the detail page + the style tag below).
// Keeping the print stylesheet local to this component avoids touching globals.css.

const money = (currency: string) => ({ format: (v: number) => formatMoneyIn(currency, v) })

// Long-month calendar date ('9 July 2026') for the printed document.
const formatDate = formatDateLong

export function PrintInvoiceButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print
    </Button>
  )
}

export function InvoicePrint({
  invoice,
  lines,
}: {
  invoice: Invoice
  lines: InvoiceLineItem[]
}) {
  const fmt = money(invoice.currency)
  const totals = invoiceTotals(
    lines.map((l) => ({ quantity: l.quantity, unit_amount: l.unit_amount })),
    invoice.tax_rate,
  )

  return (
    <>
      {/* On paper: hide the app shell, show only the print root. Scoped, no globals.css edit. */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print, #invoice-print * { visibility: visible; }
          #invoice-print { position: absolute; inset: 0; margin: 0; padding: 2rem; }
        }
      `}</style>

      <div
        id="invoice-print"
        className="hidden bg-white text-black print:block"
      >
        {/* Letterhead */}
        <div className="flex items-start justify-between border-b border-black/20 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
            <p className="mt-1 text-sm tabular-nums">{invoice.invoice_number}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">Property Ops</p>
            <p className="text-black/60">
              {invoice.direction === 'OUTBOUND' ? 'Bill to' : 'Bill from'}
            </p>
          </div>
        </div>

        {/* Party + dates */}
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wide text-black/50">
              {invoice.direction === 'OUTBOUND' ? 'Billed to' : 'Billed by'}
            </p>
            <p className="mt-1 font-medium">{invoice.party_name}</p>
            <p className="text-black/60 capitalize">{invoice.party_type.toLowerCase()}</p>
          </div>
          <div className="text-right">
            <p>
              <span className="text-black/50">Issued: </span>
              {formatDate(invoice.issue_date)}
            </p>
            {invoice.due_date && (
              <p>
                <span className="text-black/50">Due: </span>
                {formatDate(invoice.due_date)}
              </p>
            )}
            <p className="capitalize">
              <span className="text-black/50">Status: </span>
              {invoice.status.toLowerCase()}
            </p>
          </div>
        </div>

        {/* Lines */}
        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/20 text-left">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-black/10">
                <td className="py-2">{l.description}</td>
                <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="py-2 text-right tabular-nums">{fmt.format(l.unit_amount)}</td>
                <td className="py-2 text-right tabular-nums">{fmt.format(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-6 ml-auto w-64 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-black/60">Subtotal</span>
            <span className="tabular-nums">{fmt.format(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-black/60">Tax ({invoice.tax_rate}%)</span>
            <span className="tabular-nums">{fmt.format(totals.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-black/20 py-2 font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{fmt.format(totals.total)}</span>
          </div>
        </div>

        {invoice.notes && (
          <div className="mt-8 border-t border-black/10 pt-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-black/50">Notes</p>
            <p className="mt-1 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}
      </div>
    </>
  )
}
