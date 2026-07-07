// Pure invoice math + formatting — no Supabase import, so it's unit-testable and safe to
// share between the data layer and the UI.

export type InvoiceTotals = {
  subtotal: number
  tax: number
  total: number
}

// A billed line, reduced to the two fields that drive money. Accepts either a stored
// InvoiceLineItem (amount already = quantity × unit_amount) or a draft line.
export type LineForTotals = { quantity: number; unit_amount: number }

/**
 * Sum line amounts into a subtotal, apply a single tax rate (percent, 0..100), and total.
 * Rounded to cents so display and arithmetic agree. taxRate outside [0,100] is clamped.
 */
export function invoiceTotals(lines: LineForTotals[], taxRate: number): InvoiceTotals {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.quantity * l.unit_amount, 0))
  const rate = Math.max(0, Math.min(100, Number.isFinite(taxRate) ? taxRate : 0))
  const tax = round2(subtotal * (rate / 100))
  return { subtotal, tax, total: round2(subtotal + tax) }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Format a per-workspace invoice number: INV-<year>-<4-digit sequence>. The sequence is
 * the count of existing invoices + 1; uniqueness is enforced by the DB
 * (invoices_number_workspace_unique) with an app-side retry as the backstop.
 */
export function formatInvoiceNumber(sequence: number, year: number): string {
  return `INV-${year}-${String(sequence).padStart(4, '0')}`
}
