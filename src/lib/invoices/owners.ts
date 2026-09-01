import type { InvoiceStatus } from '@/types/domain'

// Owner statements derive entirely from invoices (party_type = 'OWNER'): there is no
// separate owner entity in the MVP, so an "owner" is a distinct party_name. Pure +
// DB-free so it's testable and reusable by both the owners list and a single statement.

export type OwnerInvoiceRow = {
  name: string
  currency: string
  total: number
  status: InvoiceStatus
}

// One currency's money rollup for one owner. Amounts are only ever summed within the
// SAME currency — adding across currencies without an FX rate is meaningless.
export type OwnerCurrencyTotals = {
  currency: string
  billed: number // total of all non-void invoices in this currency
  paid: number // total of PAID invoices in this currency
  outstanding: number // billed − paid
}

export type OwnerSummary = {
  name: string
  invoiceCount: number
  // Per-currency subtotals, currency code ascending. The overwhelming case is a single
  // EUR entry; more appear only when one owner has been invoiced in several currencies.
  totals: OwnerCurrencyTotals[]
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

// Sort key for the owners list: the largest outstanding balance across the owner's
// currencies. Cross-currency comparison is only ever used to ORDER rows, never to add.
function maxOutstanding(s: OwnerSummary): number {
  return s.totals.reduce((max, t) => Math.max(max, t.outstanding), 0)
}

/**
 * Group owner-billed invoices by party name — and, within an owner, by currency — into
 * per-owner per-currency totals. VOID invoices are excluded from money (they still count
 * toward invoiceCount). Sorted by outstanding balance (most owed first, each owner ranked
 * by their largest per-currency balance), then name.
 */
export function summarizeOwners(rows: OwnerInvoiceRow[]): OwnerSummary[] {
  const map = new Map<
    string,
    { name: string; invoiceCount: number; byCurrency: Map<string, { billed: number; paid: number }> }
  >()
  for (const r of rows) {
    let s = map.get(r.name)
    if (!s) {
      s = { name: r.name, invoiceCount: 0, byCurrency: new Map() }
      map.set(r.name, s)
    }
    s.invoiceCount += 1
    if (r.status !== 'VOID') {
      const code = r.currency || 'EUR'
      let c = s.byCurrency.get(code)
      if (!c) {
        c = { billed: 0, paid: 0 }
        s.byCurrency.set(code, c)
      }
      c.billed += r.total
      if (r.status === 'PAID') c.paid += r.total
    }
  }
  return [...map.values()]
    .map((s) => {
      const totals: OwnerCurrencyTotals[] = [...s.byCurrency.entries()]
        .map(([currency, c]) => {
          const billed = round2(c.billed)
          const paid = round2(c.paid)
          return { currency, billed, paid, outstanding: round2(billed - paid) }
        })
        .sort((a, b) => a.currency.localeCompare(b.currency))
      // An owner whose invoices are all VOID still gets one zero row, so every surface
      // renders €0.00 exactly as it did before currencies were tracked.
      if (totals.length === 0) totals.push({ currency: 'EUR', billed: 0, paid: 0, outstanding: 0 })
      return { name: s.name, invoiceCount: s.invoiceCount, totals }
    })
    .sort((a, b) => maxOutstanding(b) - maxOutstanding(a) || a.name.localeCompare(b.name))
}
