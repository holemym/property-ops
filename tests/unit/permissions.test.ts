import { describe, it, expect } from 'vitest'
import { can } from '@/lib/auth/permissions'

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
})
