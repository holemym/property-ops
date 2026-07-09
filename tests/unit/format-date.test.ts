import { describe, it, expect } from 'vitest'
import { formatDate, formatDateLong } from '@/lib/format-date'

describe('formatDate', () => {
  it('renders an unambiguous day-month-year (en-IE)', () => {
    expect(formatDate('2026-07-09')).toBe('9 Jul 2026')
  })

  it('accepts full ISO timestamps', () => {
    expect(formatDate('2026-12-01T08:30:00Z')).toBe('1 Dec 2026')
  })

  it('returns an em dash for null/undefined/empty', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('falls back to the raw string when unparseable', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatDateLong', () => {
  it('uses the long month name', () => {
    expect(formatDateLong('2026-07-09')).toBe('9 July 2026')
  })

  it('returns an em dash for null', () => {
    expect(formatDateLong(null)).toBe('—')
  })
})

describe('UTC pinning (calendar dates do not drift by zone)', () => {
  it('renders a date-only value as its stored calendar day', () => {
    // 2026-01-01 parses as UTC midnight; formatting in UTC keeps it on 1 Jan even in
    // negative-offset zones where local time would fall back to 31 Dec.
    expect(formatDate('2026-01-01')).toBe('1 Jan 2026')
  })
})
