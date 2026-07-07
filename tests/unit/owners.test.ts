import { describe, it, expect } from 'vitest'
import { summarizeOwners } from '@/lib/invoices/owners'

describe('summarizeOwners', () => {
  it('groups by name and sums billed / paid / outstanding', () => {
    const out = summarizeOwners([
      { name: 'Jane Owner', total: 500, status: 'SENT' },
      { name: 'Jane Owner', total: 300, status: 'PAID' },
      { name: 'Acme Holdings', total: 1000, status: 'PAID' },
    ])
    const jane = out.find((o) => o.name === 'Jane Owner')!
    expect(jane.invoiceCount).toBe(2)
    expect(jane.billed).toBe(800)
    expect(jane.paid).toBe(300)
    expect(jane.outstanding).toBe(500)
  })

  it('excludes VOID invoices from money but counts them', () => {
    const out = summarizeOwners([
      { name: 'X', total: 100, status: 'SENT' },
      { name: 'X', total: 999, status: 'VOID' },
    ])
    expect(out[0].invoiceCount).toBe(2)
    expect(out[0].billed).toBe(100)
    expect(out[0].outstanding).toBe(100)
  })

  it('sorts by outstanding (most owed first), then name', () => {
    const out = summarizeOwners([
      { name: 'Low', total: 50, status: 'SENT' },
      { name: 'High', total: 900, status: 'SENT' },
    ])
    expect(out.map((o) => o.name)).toEqual(['High', 'Low'])
  })

  it('is empty-safe', () => {
    expect(summarizeOwners([])).toEqual([])
  })
})
