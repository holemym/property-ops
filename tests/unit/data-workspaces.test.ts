import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { getWorkspace } from '@/lib/data/workspaces'

const WS_A = 'workspace-a'
const WS_B = 'workspace-b'

describe('workspaces data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      workspaces: [
        {
          id: WS_A,
          name: 'Holemym Apts',
          legal_name: null,
          address: null,
          city: 'Wien',
          country: 'Austria',
          timezone: 'Europe/Vienna',
          currency: 'EUR',
          language: 'en',
          is_active: true,
          is_demo: false,
          demo_reset_at: null,
        },
        {
          id: WS_B,
          name: 'Other Workspace',
          legal_name: null,
          address: null,
          city: null,
          country: null,
          timezone: 'Europe/Vienna',
          currency: 'USD',
          language: 'en',
          is_active: true,
          is_demo: false,
          demo_reset_at: null,
        },
      ],
    })
  })

  it('gets a workspace by id', async () => {
    const ws = await getWorkspace(client, WS_A)
    expect(ws?.name).toBe('Holemym Apts')
    expect(ws?.currency).toBe('EUR')
  })

  it('never returns a different workspace\'s row', async () => {
    const ws = await getWorkspace(client, WS_A)
    expect(ws?.id).toBe(WS_A)
    expect(ws?.name).not.toBe('Other Workspace')
  })

  it('returns null for an unknown workspace id', async () => {
    expect(await getWorkspace(client, 'nonexistent-ws')).toBeNull()
  })
})
