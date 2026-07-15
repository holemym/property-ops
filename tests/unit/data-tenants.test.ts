import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listTenants, getTenant, createTenant, updateTenant, listTenanciesForTenant } from '@/lib/data/tenants'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

describe('tenants data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      tenants: [
        // Seeded out of alphabetical order so the full_name sort assertion is real.
        { id: 'tenant-1', workspace_id: WORKSPACE_A, full_name: 'Bob Cafe', email: 'bob@cafe.example', phone: null, language: null, notes: null, created_by_user_id: 'u1', created_at: '2026-01-01T00:00:00Z' },
        { id: 'tenant-2', workspace_id: WORKSPACE_A, full_name: 'Alice Berger', email: 'alice@example.com', phone: null, language: 'de', notes: null, created_by_user_id: 'u1', created_at: '2026-01-02T00:00:00Z' },
        { id: 'tenant-3', workspace_id: WORKSPACE_B, full_name: 'Other WS Tenant', email: 'other@example.com', phone: null, language: null, notes: null, created_by_user_id: 'u2', created_at: '2026-01-03T00:00:00Z' },
      ],
      tenancies: [
        { id: 'tcy-1', workspace_id: WORKSPACE_A, unit_id: 'unit-1', tenant_id: 'tenant-2', tenant_name: 'Alice Berger', start_date: '2026-01-01', end_date: null, created_by_user_id: 'u1' },
        { id: 'tcy-2', workspace_id: WORKSPACE_A, unit_id: 'unit-2', tenant_id: null, tenant_name: 'Free Text Tenant', start_date: '2026-02-01', end_date: null, created_by_user_id: 'u1' },
        { id: 'tcy-3', workspace_id: WORKSPACE_B, unit_id: 'unit-9', tenant_id: 'tenant-3', tenant_name: 'Other WS Tenant', start_date: '2026-01-01', end_date: null, created_by_user_id: 'u2' },
      ],
    })
  })

  it('only lists tenants for the given workspace, sorted by full_name', async () => {
    const result = await listTenants(client, WORKSPACE_A)
    expect(result.map((t) => t.full_name)).toEqual(['Alice Berger', 'Bob Cafe'])
  })

  it('search matches full_name', async () => {
    const result = await listTenants(client, WORKSPACE_A, { search: 'alice' })
    expect(result.map((t) => t.full_name)).toEqual(['Alice Berger'])
  })

  it('search matches email', async () => {
    const result = await listTenants(client, WORKSPACE_A, { search: 'cafe.example' })
    expect(result.map((t) => t.full_name)).toEqual(['Bob Cafe'])
  })

  it('search never crosses into another workspace even when the term matches', async () => {
    // 'Other WS Tenant' only exists in WORKSPACE_B — searching for it from
    // WORKSPACE_A must return nothing (workspace scope wins over the search match).
    const result = await listTenants(client, WORKSPACE_A, { search: 'Other WS' })
    expect(result).toHaveLength(0)
  })

  it('creates a tenant scoped to the workspace', async () => {
    const created = await createTenant(client, {
      workspaceId: WORKSPACE_A,
      createdByUserId: 'u1',
      fullName: 'Carol Novak',
      email: 'carol@example.com',
    })
    expect(created.workspace_id).toBe(WORKSPACE_A)
    expect(created.full_name).toBe('Carol Novak')
    expect(created.language).toBeNull()
    const listed = await listTenants(client, WORKSPACE_A)
    expect(listed.map((t) => t.full_name)).toContain('Carol Novak')
  })

  it('does not return a tenant belonging to another workspace', async () => {
    const result = await getTenant(client, WORKSPACE_A, 'tenant-3')
    expect(result).toBeNull()
  })

  it('clears an optional field when updated with null', async () => {
    const before = await getTenant(client, WORKSPACE_A, 'tenant-2')
    expect(before?.language).toBe('de')

    await updateTenant(client, WORKSPACE_A, 'tenant-2', { language: null })

    const after = await getTenant(client, WORKSPACE_A, 'tenant-2')
    expect(after?.language).toBeNull()
  })

  it('leaves a field untouched when omitted from the update', async () => {
    await updateTenant(client, WORKSPACE_A, 'tenant-2', { phone: '+43 1 111 2222' })
    const after = await getTenant(client, WORKSPACE_A, 'tenant-2')
    expect(after?.full_name).toBe('Alice Berger')
    expect(after?.phone).toBe('+43 1 111 2222')
  })

  it('lists tenancies linked to a tenant within the workspace', async () => {
    const result = await listTenanciesForTenant(client, WORKSPACE_A, 'tenant-2')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('tcy-1')
  })

  it('does not leak another workspace tenancy via listTenanciesForTenant', async () => {
    const result = await listTenanciesForTenant(client, WORKSPACE_A, 'tenant-3')
    expect(result).toHaveLength(0)
  })
})
