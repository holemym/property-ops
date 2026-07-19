import { describe, it, expect, afterEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  logAuthEvent,
  normalizeEmail,
  clientUserAgent,
  resolveWorkspaceId,
  resolveAuthContext,
} from '@/lib/audit/log-auth-event'

// ---------------------------------------------------------------------------
// Pure helpers — no I/O.
// ---------------------------------------------------------------------------

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Someone@Example.com  ')).toBe('someone@example.com')
  })

  it('returns null for blank/absent input', () => {
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
  })
})

describe('clientUserAgent', () => {
  it('returns the trimmed user-agent header', () => {
    const h = new Headers({ 'user-agent': '  Mozilla/5.0  ' })
    expect(clientUserAgent(h)).toBe('Mozilla/5.0')
  })

  it('returns null when the header is absent', () => {
    expect(clientUserAgent(new Headers())).toBeNull()
  })

  it('returns null for a blank header value', () => {
    const h = new Headers({ 'user-agent': '   ' })
    expect(clientUserAgent(h)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// logAuthEvent — THE #1 CORRECTNESS PROPERTY: never throws, regardless of
// what the underlying client does. Mirrors notify-inapp.test.ts's
// createNotification coverage.
// ---------------------------------------------------------------------------

describe('logAuthEvent', () => {
  const WORKSPACE_A = 'workspace-a'

  function rowsOf(client: ReturnType<typeof createFakeSupabaseClient>) {
    return (client as unknown as { _tables: Record<string, Record<string, unknown>[]> })._tables
      .auth_events ?? []
  }

  it('writes an auth event row with normalized email and all context fields', async () => {
    const client = createFakeSupabaseClient({ auth_events: [] })
    await logAuthEvent(client, {
      eventType: 'LOGIN_SUCCESS',
      workspaceId: WORKSPACE_A,
      userId: 'user-1',
      email: '  User@Example.com ',
      ip: '203.0.113.4',
      userAgent: 'Mozilla/5.0',
    })
    const rows = rowsOf(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      workspace_id: WORKSPACE_A,
      actor_user_id: 'user-1',
      event_type: 'LOGIN_SUCCESS',
      email: 'user@example.com',
      ip: '203.0.113.4',
      user_agent: 'Mozilla/5.0',
    })
  })

  it('defaults absent optional fields to null rather than undefined', async () => {
    const client = createFakeSupabaseClient({ auth_events: [] })
    await logAuthEvent(client, { eventType: 'SIGN_OUT' })
    const rows = rowsOf(client)
    expect(rows[0]).toMatchObject({
      workspace_id: null,
      actor_user_id: null,
      email: null,
      ip: null,
      user_agent: null,
      metadata_json: null,
    })
  })

  it('passes metadata_json through untouched', async () => {
    const client = createFakeSupabaseClient({ auth_events: [] })
    await logAuthEvent(client, {
      eventType: 'DEACTIVATION',
      userId: 'admin-1',
      workspaceId: WORKSPACE_A,
      metadata: { target_user_id: 'user-9' },
    })
    expect(rowsOf(client)[0]).toMatchObject({ metadata_json: { target_user_id: 'user-9' } })
  })

  it('never writes for the demo workspace (D4-style skip)', async () => {
    const original = process.env.DEMO_WORKSPACE_ID
    process.env.DEMO_WORKSPACE_ID = 'demo-ws'
    try {
      const client = createFakeSupabaseClient({ auth_events: [] })
      await logAuthEvent(client, { eventType: 'SIGN_OUT', workspaceId: 'demo-ws' })
      expect(rowsOf(client)).toHaveLength(0)
    } finally {
      process.env.DEMO_WORKSPACE_ID = original
    }
  })

  it('NEVER THROWS when the insert resolves with an error object', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erroringClient = {
      from() {
        return {
          insert: () => Promise.resolve({ data: null, error: { message: 'relation "auth_events" does not exist' } }),
        }
      },
    } as unknown as SupabaseClient

    await expect(
      logAuthEvent(erroringClient, { eventType: 'LOGIN_SUCCESS', userId: 'user-1' })
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('NEVER THROWS when the client throws synchronously (missing table / RLS rejection / network blip)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingClient = {
      from() {
        throw new Error('boom — table does not exist')
      },
    } as unknown as SupabaseClient

    await expect(
      logAuthEvent(throwingClient, { eventType: 'LOGIN_FAILURE', email: 'x@example.com' })
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('NEVER THROWS when the insert returns a rejected promise', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rejectingClient = {
      from() {
        return { insert: () => Promise.reject(new Error('network blip')) }
      },
    } as unknown as SupabaseClient

    await expect(
      logAuthEvent(rejectingClient, { eventType: 'SIGN_OUT' })
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// resolveWorkspaceId / resolveAuthContext — best-effort identity resolution.
// Also never throw.
// ---------------------------------------------------------------------------

describe('resolveWorkspaceId', () => {
  it('returns the matching profile workspace_id', async () => {
    const client = createFakeSupabaseClient({
      profiles: [{ id: 'user-1', workspace_id: 'ws-1' }],
    })
    await expect(resolveWorkspaceId(client, 'user-1')).resolves.toBe('ws-1')
  })

  it('returns null for a null/undefined userId (no lookup attempted)', async () => {
    const client = createFakeSupabaseClient({ profiles: [] })
    await expect(resolveWorkspaceId(client, null)).resolves.toBeNull()
    await expect(resolveWorkspaceId(client, undefined)).resolves.toBeNull()
  })

  it('returns null (never throws) when no profile matches', async () => {
    const client = createFakeSupabaseClient({ profiles: [] })
    await expect(resolveWorkspaceId(client, 'ghost')).resolves.toBeNull()
  })

  it('returns null (never throws) when the client throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingClient = {
      from() {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient
    await expect(resolveWorkspaceId(throwingClient, 'user-1')).resolves.toBeNull()
    consoleSpy.mockRestore()
  })
})

describe('resolveAuthContext', () => {
  function fakeAuthClient(
    claims: { sub?: string; email?: string } | null,
    profileRows: Record<string, unknown>[]
  ): SupabaseClient {
    const dataClient = createFakeSupabaseClient({ profiles: profileRows })
    return {
      auth: { getClaims: async () => ({ data: { claims }, error: null }) },
      from: dataClient.from,
    } as unknown as SupabaseClient
  }

  it('resolves userId/email from claims and workspaceId from the profile', async () => {
    const client = fakeAuthClient(
      { sub: 'user-1', email: 'user@example.com' },
      [{ id: 'user-1', workspace_id: 'ws-1' }]
    )
    await expect(resolveAuthContext(client)).resolves.toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      workspaceId: 'ws-1',
    })
  })

  it('returns all-null when there are no claims (no session)', async () => {
    const client = fakeAuthClient(null, [])
    await expect(resolveAuthContext(client)).resolves.toEqual({
      userId: null,
      email: null,
      workspaceId: null,
    })
  })

  it('NEVER THROWS when getClaims() throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const throwingClient = {
      auth: {
        getClaims: () => {
          throw new Error('boom')
        },
      },
    } as unknown as SupabaseClient
    await expect(resolveAuthContext(throwingClient)).resolves.toEqual({
      userId: null,
      email: null,
      workspaceId: null,
    })
    consoleSpy.mockRestore()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
