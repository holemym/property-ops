import { describe, it, expect } from 'vitest'
import { isMissingBillingPeriodColumnError } from '@/lib/invoices/degrade'

// generateRentInvoicesAction's (P3-2) whole degrade-safety story hinges on this
// predicate correctly distinguishing "migration 0027 isn't applied yet" from any other
// DB error — see the file's own header comment for why both a Postgres-code and a
// PostgREST-schema-cache-code are checked, plus a message fallback.
describe('isMissingBillingPeriodColumnError', () => {
  it('recognises the raw Postgres undefined_column code (42703)', () => {
    expect(
      isMissingBillingPeriodColumnError({
        code: '42703',
        message: 'column invoices.billing_period does not exist',
      }),
    ).toBe(true)
  })

  it('recognises the PostgREST schema-cache column-not-found code (PGRST204)', () => {
    expect(
      isMissingBillingPeriodColumnError({
        code: 'PGRST204',
        message: "Column 'billing_period' of relation 'invoices' does not exist in the schema cache",
      }),
    ).toBe(true)
  })

  it('falls back to a message match when the code is absent or unrecognised', () => {
    expect(
      isMissingBillingPeriodColumnError({
        code: '',
        message: 'column "billing_period" does not exist',
      }),
    ).toBe(true)
    expect(
      isMissingBillingPeriodColumnError({
        message: "Could not find the 'billing_period' column in the schema cache",
      }),
    ).toBe(true)
  })

  it('is case-insensitive on the message fallback', () => {
    expect(
      isMissingBillingPeriodColumnError({ message: 'Column billing_period DOES NOT EXIST' }),
    ).toBe(true)
  })

  it('does NOT match an unrelated 23505 unique-violation (the dedupe-skip case)', () => {
    expect(
      isMissingBillingPeriodColumnError({
        code: '23505',
        message: 'duplicate key value violates unique constraint "invoices_tenancy_period_unique"',
      }),
    ).toBe(false)
  })

  it('does NOT match an unrelated error mentioning a different missing column', () => {
    expect(
      isMissingBillingPeriodColumnError({
        code: '42703',
        message: 'column invoices.recipient_email does not exist',
      }),
    ).toBe(false)
  })

  it('does NOT match a generic network/unknown error', () => {
    expect(isMissingBillingPeriodColumnError(new Error('fetch failed'))).toBe(false)
  })

  it('is null/undefined/non-object safe', () => {
    expect(isMissingBillingPeriodColumnError(null)).toBe(false)
    expect(isMissingBillingPeriodColumnError(undefined)).toBe(false)
    expect(isMissingBillingPeriodColumnError('a string error')).toBe(false)
    expect(isMissingBillingPeriodColumnError(42)).toBe(false)
  })
})
