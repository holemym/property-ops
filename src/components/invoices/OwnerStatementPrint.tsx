'use client'

import { formatMoneyExact } from '@/lib/format-money'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDateLong } from '@/lib/format-date'
import type { InvoiceStatus } from '@/types/domain'

// Print-friendly owner statement, mirroring InvoicePrint: a button that fires the browser
// print dialog, and a paper layout that is hidden on screen and shown alone on print
// (the @media print rule hides the app chrome and reveals only #statement-print).

const eur = { format: formatMoneyExact }

// Long-month calendar date ('9 July 2026') for the printed statement.
const formatDate = formatDateLong

export type StatementLine = {
  id: string
  number: string
  issueDate: string
  dueDate: string | null
  status: InvoiceStatus
  total: number
}

export function PrintStatementButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print statement
    </Button>
  )
}

export function OwnerStatementPrint({
  ownerName,
  lines,
  billed,
  paid,
  outstanding,
}: {
  ownerName: string
  lines: StatementLine[]
  billed: number
  paid: number
  outstanding: number
}) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #statement-print, #statement-print * { visibility: visible; }
          #statement-print { position: absolute; inset: 0; margin: 0; padding: 2rem; }
        }
      `}</style>

      <div id="statement-print" className="hidden bg-white text-black print:block">
        <div className="flex items-start justify-between border-b border-black/20 pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Owner statement</h1>
            <p className="mt-1 text-sm">{ownerName}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">Property Ops</p>
            <p className="text-black/60">{formatDate(new Date().toISOString())}</p>
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/20 text-left">
              <th className="py-2">Invoice</th>
              <th className="py-2">Issued</th>
              <th className="py-2">Due</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-black/10">
                <td className="py-2 tabular-nums">{l.number}</td>
                <td className="py-2">{formatDate(l.issueDate)}</td>
                <td className="py-2">{l.dueDate ? formatDate(l.dueDate) : '—'}</td>
                <td className="py-2 capitalize">{l.status.toLowerCase()}</td>
                <td className="py-2 text-right tabular-nums">{eur.format(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 ml-auto w-64 text-sm">
          <div className="flex justify-between py-1">
            <span className="text-black/60">Billed</span>
            <span className="tabular-nums">{eur.format(billed)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-black/60">Paid</span>
            <span className="tabular-nums">{eur.format(paid)}</span>
          </div>
          <div className="flex justify-between border-t border-black/20 py-2 font-semibold">
            <span>Outstanding</span>
            <span className="tabular-nums">{eur.format(outstanding)}</span>
          </div>
        </div>
      </div>
    </>
  )
}
