import { describe, it, expect } from 'vitest'
import { summarizeOwners } from '@/lib/invoices/owners'

describe('summarizeOwners', () => {
  it('groups by name and sums billed / paid / outstanding', () => {
    const out = summarizeOwners([
      { name: 'Jane Owner', currency: 'EUR', total: 500, status: 'SENT' },
      { name: 'Jane Owner', currency: 'EUR', total: 300, status: 'PAID' },
      { name: 'Acme Holdings', currency: 'EUR', total: 1000, status: 'PAID' },
    ])
    const jane = out.find((o) => o.name === 'Jane Owner')!
    expect(jane.invoiceCount).toBe(2)
    expect(jane.totals).toEqual([
      { currency: 'EUR', billed: 800, paid: 300, outstanding: 500 },
    ])
  })

  it('groups per currency within one owner and never sums across currencies', () => {
    const out = summarizeOwners([
      { name: 'Jane Owner', currency: 'EUR', total: 500, status: 'SENT' },
      { name: 'Jane Owner', currency: 'USD', total: 200, status: 'SENT' },
      { name: 'Jane Owner', currency: 'EUR', total: 300, status: 'PAID' },
    ])
    expect(out).toHaveLength(1)
    const jane = out[0]
    expect(jane.invoiceCount).toBe(3)
    // Currency code ascending; each currency's money stays in its own bucket.
    expect(jane.totals).toEqual([
      { currency: 'EUR', billed: 800, paid: 300, outstanding: 500 },
      { currency: 'USD', billed: 200, paid: 0, outstanding: 200 },
    ])
  })

  it('conserves amounts to the cent (no float drift in the grouping)', () => {
    const out = summarizeOwners([
      { name: 'X', currency: 'EUR', total: 0.1, status: 'SENT' },
      { name: 'X', currency: 'EUR', total: 0.2, status: 'SENT' },
      { name: 'X', currency: 'EUR', total: 1234.56, status: 'PAID' },
    ])
    expect(out[0].totals).toEqual([
      { currency: 'EUR', billed: 1234.86, paid: 1234.56, outstanding: 0.3 },
    ])
  })

  it('excludes VOID invoices from money but counts them', () => {
    const out = summarizeOwners([
      { name: 'X', currency: 'EUR', total: 100, status: 'SENT' },
      { name: 'X', currency: 'EUR', total: 999, status: 'VOID' },
    ])
    expect(out[0].invoiceCount).toBe(2)
    expect(out[0].totals).toEqual([
      { currency: 'EUR', billed: 100, paid: 0, outstanding: 100 },
    ])
  })

  it('an all-VOID owner still yields one zero EUR row', () => {
    const out = summarizeOwners([
      { name: 'X', currency: 'USD', total: 999, status: 'VOID' },
    ])
    expect(out[0].invoiceCount).toBe(1)
    expect(out[0].totals).toEqual([
      { currency: 'EUR', billed: 0, paid: 0, outstanding: 0 },
    ])
  })

  it('sorts by outstanding (most owed first), then name', () => {
    const out = summarizeOwners([
      { name: 'Low', currency: 'EUR', total: 50, status: 'SENT' },
      { name: 'High', currency: 'EUR', total: 900, status: 'SENT' },
    ])
    expect(out.map((o) => o.name)).toEqual(['High', 'Low'])
  })

  it('ranks a multi-currency owner by their largest per-currency balance', () => {
    const out = summarizeOwners([
      // Multi has 100 EUR + 800 USD outstanding — max 800 outranks Single's 500 EUR.
      { name: 'Multi', currency: 'EUR', total: 100, status: 'SENT' },
      { name: 'Multi', currency: 'USD', total: 800, status: 'SENT' },
      { name: 'Single', currency: 'EUR', total: 500, status: 'SENT' },
    ])
    expect(out.map((o) => o.name)).toEqual(['Multi', 'Single'])
  })

  it('is empty-safe', () => {
    expect(summarizeOwners([])).toEqual([])
  })
})
