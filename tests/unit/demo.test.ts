import { describe, it, expect, afterEach } from 'vitest'
import { isDemoEnabled, isDemoWorkspace, canManuallyResetDemo } from '@/lib/demo'

describe('isDemoEnabled', () => {
  const original = process.env.DEMO_MODE

  afterEach(() => {
    process.env.DEMO_MODE = original
  })

  it('is false when unset', () => {
    delete process.env.DEMO_MODE
    expect(isDemoEnabled()).toBe(false)
  })

  it('is false for any value other than "on"', () => {
    process.env.DEMO_MODE = 'true'
    expect(isDemoEnabled()).toBe(false)
  })

  it('is true when set to "on"', () => {
    process.env.DEMO_MODE = 'on'
    expect(isDemoEnabled()).toBe(true)
  })
})

describe('isDemoWorkspace', () => {
  const original = process.env.DEMO_WORKSPACE_ID

  afterEach(() => {
    process.env.DEMO_WORKSPACE_ID = original
  })

  it('is false when DEMO_WORKSPACE_ID is unset, regardless of input', () => {
    delete process.env.DEMO_WORKSPACE_ID
    expect(isDemoWorkspace('11111111-1111-1111-1111-111111111111')).toBe(false)
  })

  it('is true when the workspace id matches DEMO_WORKSPACE_ID', () => {
    process.env.DEMO_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
    expect(isDemoWorkspace('11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it('is false for a different workspace id', () => {
    process.env.DEMO_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
    expect(isDemoWorkspace('22222222-2222-2222-2222-222222222222')).toBe(false)
  })

  it('is false for null', () => {
    process.env.DEMO_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
    expect(isDemoWorkspace(null)).toBe(false)
  })

  it('is false for undefined', () => {
    process.env.DEMO_WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'
    expect(isDemoWorkspace(undefined)).toBe(false)
  })
})

// D7: the emergency manual-reset control (Settings > Users) must be reachable by
// SUPER_ADMIN alone — not even OWNER, despite OWNER sharing every other admin
// permission with SUPER_ADMIN via ADMIN_PERMISSIONS (src/lib/auth/permissions.ts).
describe('canManuallyResetDemo', () => {
  it('is true for SUPER_ADMIN', () => {
    expect(canManuallyResetDemo('SUPER_ADMIN')).toBe(true)
  })

  it('is false for OWNER', () => {
    expect(canManuallyResetDemo('OWNER')).toBe(false)
  })

  it('is false for every other role', () => {
    expect(canManuallyResetDemo('OPERATOR')).toBe(false)
    expect(canManuallyResetDemo('ACCOUNTANT')).toBe(false)
    expect(canManuallyResetDemo('TENANT')).toBe(false)
    expect(canManuallyResetDemo('GUEST')).toBe(false)
    expect(canManuallyResetDemo('VENDOR')).toBe(false)
  })
})
