// Pure invoice math + formatting — no Supabase import, so it's unit-testable and safe to
// share between the data layer and the UI.

import type { InvoiceStatus } from '@/types/domain'

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

// Statuses "Generate rent" (Track P3) or a manual Send can leave sitting unpaid past
// their due date. Only these two are eligible — DRAFT hasn't been sent yet, PAID/VOID
// are terminal, so neither can be "overdue" in any useful sense.
const OVERDUE_ELIGIBLE_STATUSES = new Set<InvoiceStatus>(['SENT', 'PARTIAL'])

/**
 * Whether an invoice should show as OVERDUE right now — DERIVED and display-only (spec
 * P3 §3): the stored `status` column never becomes 'OVERDUE' and nothing here mutates
 * it, so this is safe to call from any read path (list, detail) without a write. Strict
 * `<` — an invoice due exactly today is not yet overdue. `todayIso` is injected (no
 * `Date.now()`/`new Date()` inside), the same no-hidden-clock discipline as the rent
 * planner (src/lib/invoices/recurring.ts) and the occupancy/rent-roll pure modules.
 */
export function isInvoiceOverdue(
  invoice: { status: InvoiceStatus; due_date: string | null },
  todayIso: string,
): boolean {
  return (
    invoice.due_date !== null &&
    invoice.due_date < todayIso &&
    OVERDUE_ELIGIBLE_STATUSES.has(invoice.status)
  )
}
