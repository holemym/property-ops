import { describe, it, expect } from 'vitest'
import { can, assertPermission } from '@/lib/auth/permissions'

describe('can', () => {
  it('allows OWNER to manage the workspace', () => {
    expect(can('OWNER', 'workspace:manage')).toBe(true)
  })

  it('allows OPERATOR to write properties but not manage the workspace', () => {
    expect(can('OPERATOR', 'properties:write')).toBe(true)
    expect(can('OPERATOR', 'workspace:manage')).toBe(false)
  })

  it('allows ACCOUNTANT to read but not write vendors', () => {
    expect(can('ACCOUNTANT', 'vendors:read')).toBe(true)
    expect(can('ACCOUNTANT', 'vendors:write')).toBe(false)
  })

  it('denies TENANT any portfolio permission', () => {
    expect(can('TENANT', 'properties:read')).toBe(false)
    expect(can('TENANT', 'properties:write')).toBe(false)
    expect(can('TENANT', 'units:read')).toBe(false)
    expect(can('TENANT', 'vendors:read')).toBe(false)
  })

  it('grants SUPER_ADMIN every permission granted to OWNER', () => {
    expect(can('SUPER_ADMIN', 'workspace:manage')).toBe(true)
    expect(can('SUPER_ADMIN', 'users:manage')).toBe(true)
  })

  it('denies GUEST and VENDOR any portfolio permission', () => {
    expect(can('GUEST', 'properties:read')).toBe(false)
    expect(can('VENDOR', 'properties:read')).toBe(false)
  })

  it('grants OPERATOR all four ticket permissions', () => {
    expect(can('OPERATOR', 'tickets:read')).toBe(true)
    expect(can('OPERATOR', 'tickets:write')).toBe(true)
    expect(can('OPERATOR', 'tickets:assign')).toBe(true)
    expect(can('OPERATOR', 'tickets:comment-internal')).toBe(true)
  })

  it('grants OWNER and SUPER_ADMIN all four ticket permissions', () => {
    for (const role of ['OWNER', 'SUPER_ADMIN'] as const) {
      expect(can(role, 'tickets:read')).toBe(true)
      expect(can(role, 'tickets:write')).toBe(true)
      expect(can(role, 'tickets:assign')).toBe(true)
      expect(can(role, 'tickets:comment-internal')).toBe(true)
    }
  })

  it('grants ACCOUNTANT tickets:read only (read-only oversight)', () => {
    expect(can('ACCOUNTANT', 'tickets:read')).toBe(true)
    expect(can('ACCOUNTANT', 'tickets:write')).toBe(false)
    expect(can('ACCOUNTANT', 'tickets:assign')).toBe(false)
    expect(can('ACCOUNTANT', 'tickets:comment-internal')).toBe(false)
  })

  it('denies TENANT, GUEST and VENDOR every ticket matrix permission', () => {
    for (const role of ['TENANT', 'GUEST', 'VENDOR'] as const) {
      expect(can(role, 'tickets:read')).toBe(false)
      expect(can(role, 'tickets:write')).toBe(false)
      expect(can(role, 'tickets:assign')).toBe(false)
      expect(can(role, 'tickets:comment-internal')).toBe(false)
    }
  })
})

describe('assertPermission', () => {
  it('does not throw when the role has the permission', () => {
    expect(() => assertPermission('OWNER', 'workspace:manage')).not.toThrow()
  })

  it('throws with a clear message when the role lacks the permission', () => {
    expect(() => assertPermission('TENANT', 'properties:read')).toThrow(
      'Role TENANT lacks permission properties:read'
    )
  })
})
