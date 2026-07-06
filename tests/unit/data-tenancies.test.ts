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
    expect(created.end_date).toBeNull()
    expect(created.created_by_user_id).toBe('u1')
    const listed = await listTenancies(client, WORKSPACE_A)
    expect(listed.map((t) => t.tenant_name)).toContain('Dave')
  })
})
