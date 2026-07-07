import { describe, it, expect } from 'vitest'
import { sanitizeSearch } from '@/lib/data/search'

describe('sanitizeSearch', () => {
  it('keeps ordinary words and trims', () => {
    expect(sanitizeSearch('  ringstrasse  ')).toBe('ringstrasse')
  })

  it('strips PostgREST filter-breaking characters (comma, parens)', () => {
    // These would otherwise let a query inject extra `.or()` filter terms.
    expect(sanitizeSearch('a,b')).toBe('a b')
    expect(sanitizeSearch('x)or(y')).toBe('x or y'.replace(/\s+/g, ' '))
    expect(sanitizeSearch('foo(bar)')).not.toContain('(')
    expect(sanitizeSearch('foo(bar)')).not.toContain(')')
  })

  it('strips ilike wildcards so they are not user-controllable', () => {
    expect(sanitizeSearch('50%')).not.toContain('%')
    expect(sanitizeSearch('a_b')).not.toContain('_')
    expect(sanitizeSearch('a*b')).not.toContain('*')
  })

  it('preserves characters useful for matching (letters, digits, @, .)', () => {
    expect(sanitizeSearch('jane@acme.com')).toBe('jane@acme.com')
  })
})
