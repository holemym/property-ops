import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listVendors, getVendor, createVendor, updateVendor, setVendorActive } from '@/lib/data/vendors'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

describe('vendors data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      vendors: [
        { id: 'vendor-1', workspace_id: WORKSPACE_A, company_name: 'Alpha Plumbing', service_category: 'PLUMBING', is_active: true, notes: 'reliable', created_at: '2026-01-01T00:00:00Z' },
        { id: 'vendor-2', workspace_id: WORKSPACE_A, company_name: 'Bravo Electric', service_category: 'ELECTRICAL', is_active: false, notes: null, created_at: '2026-01-02T00:00:00Z' },
        { id: 'vendor-3', workspace_id: WORKSPACE_B, company_name: 'Other WS Vendor', service_category: 'OTHER', is_active: true, notes: null, created_at: '2026-01-03T00:00:00Z' },
      ],
    })
  })

  it('only lists vendors for the given workspace', async () => {
    const result = await listVendors(client, WORKSPACE_A)
    expect(result).toHaveLength(2)
    expect(result.map((v) => v.company_name)).not.toContain('Other WS Vendor')
  })

  it('filters by category', async () => {
    const result = await listVendors(client, WORKSPACE_A, { category: 'PLUMBING' })
    expect(result).toHaveLength(1)
    expect(result[0].company_name).toBe('Alpha Plumbing')
  })

  it('filters by isActive', async () => {
    const active = await listVendors(client, WORKSPACE_A, { isActive: true })
    expect(active.map((v) => v.company_name)).toEqual(['Alpha Plumbing'])
    const inactive = await listVendors(client, WORKSPACE_A, { isActive: false })
    expect(inactive.map((v) => v.company_name)).toEqual(['Bravo Electric'])
  })

  it('creates a vendor scoped to the workspace and active by default', async () => {
    const created = await createVendor(client, {
      workspaceId: WORKSPACE_A,
      companyName: 'Charlie Cleaning',
      serviceCategory: 'CLEANING',
    })
    expect(created.workspace_id).toBe(WORKSPACE_A)
    expect(created.is_active).toBe(true)
    const listed = await listVendors(client, WORKSPACE_A)
    expect(listed.map((v) => v.company_name)).toContain('Charlie Cleaning')
  })

  it('setVendorActive toggles the is_active flag', async () => {
    const deactivated = await setVendorActive(client, WORKSPACE_A, 'vendor-1', false)
    expect(deactivated.is_active).toBe(false)
    const reactivated = await setVendorActive(client, WORKSPACE_A, 'vendor-1', true)
    expect(reactivated.is_active).toBe(true)
  })

  it('does not return a vendor belonging to another workspace', async () => {
    const result = await getVendor(client, WORKSPACE_A, 'vendor-3')
    expect(result).toBeNull()
  })

  it('clears an optional field when updated with null', async () => {
    const before = await getVendor(client, WORKSPACE_A, 'vendor-1')
    expect(before?.notes).toBe('reliable')

    await updateVendor(client, WORKSPACE_A, 'vendor-1', { notes: null })

    const after = await getVendor(client, WORKSPACE_A, 'vendor-1')
    expect(after?.notes).toBeNull()
  })
})
