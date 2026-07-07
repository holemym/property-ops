import type { InvoiceStatus } from '@/types/domain'

// Owner statements derive entirely from invoices (party_type = 'OWNER'): there is no
// separate owner entity in the MVP, so an "owner" is a distinct party_name. Pure +
// DB-free so it's testable and reusable by both the owners list and a single statement.

export type OwnerInvoiceRow = { name: string; total: number; status: InvoiceStatus }

export type OwnerSummary = {
  name: string
  invoiceCount: number
  billed: number // total of all non-void invoices
  paid: number // total of PAID invoices
  outstanding: number // billed − paid
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Group owner-billed invoices by party name into per-owner totals. VOID invoices are
 * excluded from money (they still count toward invoiceCount). Sorted by outstanding
 * balance (most owed first), then name.
 */
export function summarizeOwners(rows: OwnerInvoiceRow[]): OwnerSummary[] {
  const map = new Map<string, OwnerSummary>()
  for (const r of rows) {
    const s =
      map.get(r.name) ?? { name: r.name, invoiceCount: 0, billed: 0, paid: 0, outstanding: 0 }
    s.invoiceCount += 1
    if (r.status !== 'VOID') {
      s.billed += r.total
      if (r.status === 'PAID') s.paid += r.total
    }
    map.set(r.name, s)
  }
  return [...map.values()]
    .map((s) => {
      const billed = round2(s.billed)
      const paid = round2(s.paid)
      return { ...s, billed, paid, outstanding: round2(billed - paid) }
    })
    .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name))
}
