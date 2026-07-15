import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listTenancies, listTenanciesForUnit, createTenancy } from '@/lib/data/tenancies'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

describe('tenancies data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      tenancies: [
        { id: 'ten-1', workspace_id: WORKSPACE_A, unit_id: 'unit-1', tenant_name: 'Alice', start_date: '2026-01-01', end_date: '2026-04-01', created_by_user_id: 'u1' },
        { id: 'ten-2', workspace_id: WORKSPACE_A, unit_id: 'unit-1', tenant_name: 'Bob', start_date: '2026-04-01', end_date: null, created_by_user_id: 'u1' },
        { id: 'ten-3', workspace_id: WORKSPACE_A, unit_id: 'unit-2', tenant_name: 'Carol', start_date: '2026-02-01', end_date: null, created_by_user_id: 'u1' },
        { id: 'ten-4', workspace_id: WORKSPACE_B, unit_id: 'unit-9', tenant_name: 'Other WS', start_date: '2026-01-01', end_date: null, created_by_user_id: 'u2' },
      ],
      tenants: [
        { id: 'person-1', workspace_id: WORKSPACE_A, full_name: 'Directory Person', email: 'person@example.com', phone: null, language: null, notes: null, created_by_user_id: 'u1' },
        { id: 'person-2', workspace_id: WORKSPACE_B, full_name: 'Other WS Person', email: null, phone: null, language: null, notes: null, created_by_user_id: 'u2' },
      ],
    })
  })

  it('only lists tenancies for the given workspace', async () => {
    const result = await listTenancies(client, WORKSPACE_A)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.tenant_name)).not.toContain('Other WS')
  })

  it('lists tenancies for a single unit within the workspace', async () => {
    const result = await listTenanciesForUnit(client, WORKSPACE_A, 'unit-1')
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.tenant_name).sort()).toEqual(['Alice', 'Bob'])
  })

  it('does not leak another workspace unit via listTenanciesForUnit', async () => {
    const result = await listTenanciesForUnit(client, WORKSPACE_A, 'unit-9')
    expect(result).toHaveLength(0)
  })

  it('creates a tenancy with workspace + unit scoping and open-ended end_date', async () => {
    const created = await createTenancy(client, {
      workspaceId: WORKSPACE_A,
      unitId: 'unit-2',
      createdByUserId: 'u1',
      tenantName: 'Dave',
      startDate: '2026-05-01',
    })
    expect(created.workspace_id).toBe(WORKSPACE_A)
    expect(created.unit_id).toBe('unit-2')
    expect(created.tenant_name).toBe('Dave')
    expect(created.tenant_id).toBeNull()
    expect(created.end_date).toBeNull()
    expect(created.created_by_user_id).toBe('u1')
    const listed = await listTenancies(client, WORKSPACE_A)
    expect(listed.map((t) => t.tenant_name)).toContain('Dave')
  })

  // P1-3: server-side name resolution. Free-text-only tenancies (tenantId omitted)
  // are covered by the test above (tenant_id stays null, tenantName is trusted as-is).

  it('resolves tenant_name from the linked directory person, ignoring the client-supplied name', async () => {
    const created = await createTenancy(client, {
      workspaceId: WORKSPACE_A,
      unitId: 'unit-2',
      createdByUserId: 'u1',
      tenantId: 'person-1',
      // Deliberately wrong/stale — must be discarded in favour of the directory
      // record's real full_name.
      tenantName: 'Whatever The Client Sent',
      startDate: '2026-05-01',
    })
    expect(created.tenant_id).toBe('person-1')
    expect(created.tenant_name).toBe('Directory Person')
  })

  it('throws when the linked person id does not resolve in the caller workspace', async () => {
    await expect(
      createTenancy(client, {
        workspaceId: WORKSPACE_A,
        unitId: 'unit-2',
        createdByUserId: 'u1',
        // person-2 exists, but only in WORKSPACE_B — must not resolve across the
        // workspace boundary (same isolation getTenant already enforces).
        tenantId: 'person-2',
        tenantName: 'Irrelevant',
        startDate: '2026-05-01',
      })
    ).rejects.toThrow('Selected person was not found in your workspace.')
  })

  it('throws when the linked person id does not exist at all', async () => {
    await expect(
      createTenancy(client, {
        workspaceId: WORKSPACE_A,
        unitId: 'unit-2',
        createdByUserId: 'u1',
        tenantId: 'nonexistent-person',
        tenantName: 'Irrelevant',
        startDate: '2026-05-01',
      })
    ).rejects.toThrow('Selected person was not found in your workspace.')
  })
})
