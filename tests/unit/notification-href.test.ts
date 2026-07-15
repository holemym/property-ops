import { describe, it, expect } from 'vitest'
import { resolveNotificationHref } from '@/lib/notifications/resolve-href'
import type { Role } from '@/types/domain'

const OPERATOR_ROLES: Role[] = ['SUPER_ADMIN', 'OWNER', 'OPERATOR', 'ACCOUNTANT', 'VENDOR']

describe('resolveNotificationHref', () => {
  it('rewrites a /tickets/<id> href to /portal/<id> for TENANT', () => {
    expect(resolveNotificationHref('/tickets/abc-123', 'TENANT')).toBe('/portal/abc-123')
  })

  it('rewrites a /tickets/<id> href to /portal/<id> for GUEST', () => {
    expect(resolveNotificationHref('/tickets/abc-123', 'GUEST')).toBe('/portal/abc-123')
  })

  it('leaves the href untouched for every operator-surface role', () => {
    for (const role of OPERATOR_ROLES) {
      expect(resolveNotificationHref('/tickets/abc-123', role)).toBe('/tickets/abc-123')
    }
  })

  it('leaves a non-ticket href untouched even for a tenant (no blanket rewrite)', () => {
    expect(resolveNotificationHref('/notifications', 'TENANT')).toBe('/notifications')
  })

  it('preserves the full id, including one containing slashes-adjacent characters', () => {
    expect(resolveNotificationHref('/tickets/0f1e2d3c-uuid', 'TENANT')).toBe('/portal/0f1e2d3c-uuid')
  })
})
