import { describe, it, expect } from 'vitest'
import { formatUnreadBadge } from '@/lib/notifications/unread-badge'

describe('formatUnreadBadge', () => {
  it('returns null at zero — the bell renders with no chip', () => {
    expect(formatUnreadBadge(0)).toBeNull()
  })

  it('returns null for a defensive negative count', () => {
    expect(formatUnreadBadge(-1)).toBeNull()
  })

  it('returns the exact digit for 1 through 9', () => {
    for (let n = 1; n <= 9; n++) {
      expect(formatUnreadBadge(n)).toBe(String(n))
    }
  })

  it('caps at "9+" for 10 and anything larger', () => {
    expect(formatUnreadBadge(10)).toBe('9+')
    expect(formatUnreadBadge(11)).toBe('9+')
    expect(formatUnreadBadge(999)).toBe('9+')
  })
})
