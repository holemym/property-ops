import { describe, it, expect } from 'vitest'
import { relativeDay } from '@/lib/relative-date'

// Fixed "now" so the assertions are deterministic regardless of when the suite runs.
const NOW = new Date('2026-07-07T12:00:00')
const at = (iso: string) => relativeDay(iso, NOW)

describe('relativeDay', () => {
  it('labels the same day as Today', () => {
    expect(at('2026-07-07T09:00:00')).toBe('Today')
  })

  it('labels the previous day as Yesterday', () => {
    expect(at('2026-07-06T23:00:00')).toBe('Yesterday')
  })

  it('counts days within the last week', () => {
    expect(at('2026-07-04T10:00:00')).toBe('3d ago')
  })

  it('counts weeks under a month', () => {
    expect(at('2026-06-20T10:00:00')).toBe('2w ago')
  })

  it('falls back to an absolute date for older, same-year dates', () => {
    // ~4 months back, same year → an absolute day/month (locale-formatted), not a
    // relative "d/w ago". Assert locale-agnostically: contains the day, no relative words.
    const label = at('2026-03-12T10:00:00')
    expect(label).not.toMatch(/ago|Today|Yesterday/)
    expect(label).toContain('12')
  })

  it('includes the year for a different-year date', () => {
    expect(at('2025-11-02T10:00:00')).toMatch(/2025/)
  })

  it('is empty-safe for an invalid date', () => {
    expect(at('not-a-date')).toBe('')
  })
})
