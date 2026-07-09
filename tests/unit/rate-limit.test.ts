import { describe, it, expect } from 'vitest'
import { clientIp } from '@/lib/rate-limit'

describe('clientIp', () => {
  it('returns the first hop of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.4, 10.0.0.1' })
    expect(clientIp(h)).toBe('203.0.113.4')
  })

  it('trims whitespace around the first hop', () => {
    const h = new Headers({ 'x-forwarded-for': '  203.0.113.4  , 10.0.0.1' })
    expect(clientIp(h)).toBe('203.0.113.4')
  })

  it('returns "unknown" when the header is absent', () => {
    expect(clientIp(new Headers())).toBe('unknown')
  })

  it('returns "unknown" for an empty header value', () => {
    const h = new Headers({ 'x-forwarded-for': '' })
    expect(clientIp(h)).toBe('unknown')
  })
})
