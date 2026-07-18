import { describe, it, expect } from 'vitest'
import { invoiceTotals, formatInvoiceNumber, isInvoiceOverdue } from '@/lib/invoices/compute'
import {
  invoiceFormSchema,
  invoiceLineSchema,
  invoiceStatusSchema,
  rentMonthSchema,
} from '@/lib/validation/invoice'

describe('invoiceTotals', () => {
  it('sums lines, applies tax, and rounds to cents', () => {
    const t = invoiceTotals(
      [
        { quantity: 2, unit_amount: 100 }, // 200
        { quantity: 1, unit_amount: 49.99 }, // 49.99
      ],
      20,
    )
    expect(t.subtotal).toBe(249.99)
    expect(t.tax).toBe(50) // 249.99 × 0.20 = 49.998 → 50.00
    expect(t.total).toBe(299.99)
  })

  it('handles a zero tax rate', () => {
    const t = invoiceTotals([{ quantity: 3, unit_amount: 10 }], 0)
    expect(t).toEqual({ subtotal: 30, tax: 0, total: 30 })
  })

  it('supports a negative (credit) line', () => {
    const t = invoiceTotals(
      [
        { quantity: 1, unit_amount: 100 },
        { quantity: 1, unit_amount: -30 }, // credit
      ],
      0,
    )
    expect(t.total).toBe(70)
  })

  it('clamps an out-of-range tax rate', () => {
    const t = invoiceTotals([{ quantity: 1, unit_amount: 100 }], 250)
    expect(t.tax).toBe(100) // clamped to 100%
  })

  it('is empty-safe', () => {
    expect(invoiceTotals([], 20)).toEqual({ subtotal: 0, tax: 0, total: 0 })
  })
})

describe('formatInvoiceNumber', () => {
  it('zero-pads the sequence to four digits', () => {
    expect(formatInvoiceNumber(1, 2026)).toBe('INV-2026-0001')
    expect(formatInvoiceNumber(42, 2026)).toBe('INV-2026-0042')
  })

  it('does not truncate a sequence beyond four digits', () => {
    expect(formatInvoiceNumber(12345, 2026)).toBe('INV-2026-12345')
  })
})

describe('invoiceLineSchema', () => {
  it('accepts a valid line and coerces string numbers', () => {
    const r = invoiceLineSchema.safeParse({ description: 'Cleaning', quantity: '2', unitAmount: '75.5' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ description: 'Cleaning', quantity: 2, unitAmount: 75.5 })
  })

  it('rejects a non-positive quantity', () => {
    expect(invoiceLineSchema.safeParse({ description: 'x', quantity: 0, unitAmount: 10 }).success).toBe(false)
  })

  it('rejects an empty description', () => {
    expect(invoiceLineSchema.safeParse({ description: '', quantity: 1, unitAmount: 10 }).success).toBe(false)
  })
})

describe('invoiceFormSchema', () => {
  const valid = {
    partyType: 'OWNER',
    partyName: 'Jane Owner',
    issueDate: '2026-07-07',
    lines: [{ description: 'Management fee', quantity: 1, unitAmount: 500 }],
  }

  it('accepts a minimal valid invoice and applies defaults', () => {
    const r = invoiceFormSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.direction).toBe('OUTBOUND')
      expect(r.data.currency).toBe('EUR')
      expect(r.data.taxRate).toBe(0)
    }
  })

  it('requires at least one line', () => {
    expect(invoiceFormSchema.safeParse({ ...valid, lines: [] }).success).toBe(false)
  })

  it('rejects a bad party type', () => {
    expect(invoiceFormSchema.safeParse({ ...valid, partyType: 'LANDLORD' }).success).toBe(false)
  })

  it('rejects a tax rate over 100', () => {
    expect(invoiceFormSchema.safeParse({ ...valid, taxRate: 150 }).success).toBe(false)
  })

  it('rejects a malformed date', () => {
    expect(invoiceFormSchema.safeParse({ ...valid, issueDate: '07/07/2026' }).success).toBe(false)
  })
})

describe('invoiceStatusSchema', () => {
  it('accepts a valid status', () => {
    expect(invoiceStatusSchema.safeParse({ status: 'PAID' }).success).toBe(true)
  })
  it('rejects a bad status', () => {
    expect(invoiceStatusSchema.safeParse({ status: 'REFUNDED' }).success).toBe(false)
  })
})

describe('rentMonthSchema', () => {
  it('accepts a YYYY-MM value', () => {
    expect(rentMonthSchema.safeParse({ month: '2026-07' }).success).toBe(true)
  })
  it('rejects a full calendar date', () => {
    expect(rentMonthSchema.safeParse({ month: '2026-07-01' }).success).toBe(false)
  })
  it('rejects an empty string', () => {
    expect(rentMonthSchema.safeParse({ month: '' }).success).toBe(false)
  })
  it('rejects a missing field', () => {
    expect(rentMonthSchema.safeParse({}).success).toBe(false)
  })
})

describe('isInvoiceOverdue', () => {
  const TODAY = '2026-07-15'

  it('a SENT invoice past its due date is overdue', () => {
    expect(isInvoiceOverdue({ status: 'SENT', due_date: '2026-07-01' }, TODAY)).toBe(true)
  })

  it('a PARTIAL invoice past its due date is overdue', () => {
    expect(isInvoiceOverdue({ status: 'PARTIAL', due_date: '2026-07-01' }, TODAY)).toBe(true)
  })

  it('due exactly today is NOT yet overdue (strict <)', () => {
    expect(isInvoiceOverdue({ status: 'SENT', due_date: TODAY }, TODAY)).toBe(false)
  })

  it('due in the future is not overdue', () => {
    expect(isInvoiceOverdue({ status: 'SENT', due_date: '2026-08-01' }, TODAY)).toBe(false)
  })

  it('a null due_date is never overdue', () => {
    expect(isInvoiceOverdue({ status: 'SENT', due_date: null }, TODAY)).toBe(false)
  })

  it('DRAFT is never overdue, even past its due date', () => {
    expect(isInvoiceOverdue({ status: 'DRAFT', due_date: '2026-07-01' }, TODAY)).toBe(false)
  })

  it('PAID is never overdue, even past its due date', () => {
    expect(isInvoiceOverdue({ status: 'PAID', due_date: '2026-07-01' }, TODAY)).toBe(false)
  })

  it('VOID is never overdue, even past its due date', () => {
    expect(isInvoiceOverdue({ status: 'VOID', due_date: '2026-07-01' }, TODAY)).toBe(false)
  })
})
