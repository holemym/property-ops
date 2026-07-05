import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, type RlsFixture } from './helpers'

// Transcribes cross-workspace isolation smoke tests from migrations 0003 (props),
// 0009 (units), 0010 (vendors), 0011/0013 (tickets): case 2 (SELECT zero of the
// other workspace) + the adversarial cross-workspace INSERT/UPDATE WITH-CHECK
// cases (0003 #6/#7, 0009 #6/#7, 0010 #6/#7).
describe.skipIf(!hasLiveCreds())('RLS: cross-workspace isolation', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  it('A-owner sees ZERO of B rows across every scoped table', async () => {
    const a = f.clients.aOwner
    for (const table of ['properties', 'units', 'vendors', 'tickets']) {
      const { data } = await a.from(table).select('id').eq('workspace_id', f.workspaceB)
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('B-owner sees ZERO of A rows across every scoped table', async () => {
    const b = f.clients.bOwner
    for (const table of ['properties', 'units', 'vendors', 'tickets']) {
      const { data } = await b.from(table).select('id').eq('workspace_id', f.workspaceA)
      expect(data ?? []).toHaveLength(0)
    }
    // And positive control: A-owner CAN see A's own property.
    const { data: own } = await f.clients.aOwner
      .from('properties')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect((own ?? []).length).toBeGreaterThan(0)
  })

  it('B-owner UPDATE of an A property affects 0 rows (RLS filters it out)', async () => {
    const { data } = await f.clients.bOwner
      .from('properties')
      .update({ name: 'HACKED' })
      .eq('id', f.propertyA)
      .select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('A-owner INSERT with workspace_id = B is REJECTED by WITH CHECK', async () => {
    const { data, error } = await f.clients.aOwner
      .from('properties')
      .insert({
        workspace_id: f.workspaceB,
        name: 'planted',
        address_line1: 'x',
        city: 'x',
        postal_code: 'x',
        country: 'AT',
      })
      .select('id')
    // Either an outright policy error, or no row returned — never a planted row.
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('A-owner cannot move an A property into workspace B (workspace-hop UPDATE)', async () => {
    const { data } = await f.clients.aOwner
      .from('properties')
      .update({ workspace_id: f.workspaceB })
      .eq('id', f.propertyA)
      .select('id')
    expect(data ?? []).toHaveLength(0)
    // Confirm it did NOT move.
    const { data: still } = await f.clients.aOwner
      .from('properties')
      .select('workspace_id')
      .eq('id', f.propertyA)
      .single()
    expect(still?.workspace_id).toBe(f.workspaceA)
  })
})
