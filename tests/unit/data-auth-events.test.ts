import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listRecentAuthEvents, authEventLabel } from '@/lib/data/auth-events'

describe('listRecentAuthEvents', () => {
  const WORKSPACE_A = 'workspace-a'

  it('returns the workspace-scoped rows, newest first', async () => {
    const client = createFakeSupabaseClient({
      auth_events: [
        { id: '1', workspace_id: WORKSPACE_A, event_type: 'LOGIN_SUCCESS', created_at: '2026-01-01T00:00:00Z' },
        { id: '2', workspace_id: WORKSPACE_A, event_type: 'SIGN_OUT', created_at: '2026-01-03T00:00:00Z' },
        { id: '3', workspace_id: 'other-ws', event_type: 'LOGIN_SUCCESS', created_at: '2026-01-02T00:00:00Z' },
      ],
    })
    const rows = await listRecentAuthEvents(client, WORKSPACE_A)
    expect(rows.map((r) => r.id)).toEqual(['2', '1'])
  })

  // DEFENSIVE, UNLIKE EVERY OTHER READ IN THIS DATA LAYER: migrations 0022-0028
  // have not shipped to production yet, so `auth_events` does not exist there.
  // This must degrade to [] rather than 500 the settings page.
  it('returns [] (never throws) when the query resolves with an error (e.g. missing table)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erroringClient = {
      from() {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: () =>
            Promise.resolve({ data: null, error: { message: 'relation "auth_events" does not exist' } }),
        }
        return builder
      },
    } as unknown as SupabaseClient

    await expect(listRecentAuthEvents(erroringClient, WORKSPACE_A)).resolves.toEqual([])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('returns [] (never throws) when the client throws synchronously', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingClient = {
      from() {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient

    await expect(listRecentAuthEvents(throwingClient, WORKSPACE_A)).resolves.toEqual([])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe('authEventLabel', () => {
  it('maps every known event type to a human label', () => {
    expect(authEventLabel('LOGIN_SUCCESS')).toBe('Login succeeded')
    expect(authEventLabel('LOGIN_FAILURE')).toBe('Login failed')
    expect(authEventLabel('SIGNUP_SUCCESS')).toBe('Account created')
    expect(authEventLabel('SIGN_OUT')).toBe('Signed out')
    expect(authEventLabel('PASSWORD_CHANGE')).toBe('Password changed')
    expect(authEventLabel('INVITE_SENT')).toBe('Invite sent')
    expect(authEventLabel('DEACTIVATION')).toBe('User deactivated')
    expect(authEventLabel('MFA_CHALLENGE_SUCCESS')).toBe('Two-factor code verified')
    expect(authEventLabel('MFA_CHALLENGE_FAILURE')).toBe('Two-factor code rejected')
  })

  it('falls back to the raw enum value for an unrecognized type', () => {
    // @ts-expect-error — deliberately exercising the fallback for a future/unmapped value.
    expect(authEventLabel('SOME_FUTURE_EVENT')).toBe('SOME_FUTURE_EVENT')
  })
})
