import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// Transcribes role-differentiation + is_active-pin smoke tests:
//   0003 #3 (ACCOUNTANT read-only), 0002 #3 (self role/workspace change blocked,
//   full_name allowed), 0007 #1/#2 (deactivated user can't self-reactivate; can
//   still change full_name), 0008 #2 (deactivated manager can't write).
describe.skipIf(!hasLiveCreds())('RLS: role differentiation + is_active pins', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  const newProp = (workspaceId: string, name: string) => ({
    workspace_id: workspaceId,
    name,
    address_line1: 'x',
    city: 'x',
    postal_code: 'x',
    country: 'AT',
  })

  it('ACCOUNTANT can SELECT properties but CANNOT INSERT (read-only)', async () => {
    const acc = f.clients.aAccountant
    const { data: read } = await acc.from('properties').select('id').eq('workspace_id', f.workspaceA)
    expect((read ?? []).length).toBeGreaterThan(0)

    const { data, error } = await acc
      .from('properties')
      .insert(newProp(f.workspaceA, 'acc-attempt'))
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('OPERATOR (active manager) CAN INSERT a property', async () => {
    const { data, error } = await f.clients.aOperator
      .from('properties')
      .insert(newProp(f.workspaceA, 'op-created'))
      .select('id')
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(1)
  })

  it('OPERATOR can update own full_name but NOT own role (0002 #3)', async () => {
    const op = f.clients.aOperator
    const { data: ok } = await op
      .from('profiles')
      .update({ full_name: 'Renamed Operator' })
      .eq('id', f.users.aOperator.id)
      .select('id')
    expect((ok ?? []).length).toBe(1)

    const { data: blocked } = await op
      .from('profiles')
      .update({ role: 'OWNER' })
      .eq('id', f.users.aOperator.id)
      .select('id')
    expect(blocked ?? []).toHaveLength(0)
    // And role is unchanged in the DB.
    const s = svc()
    const { data: check } = await s
      .from('profiles')
      .select('role')
      .eq('id', f.users.aOperator.id)
      .single()
    expect(check?.role).toBe('OPERATOR')
  })

  it('deactivated OWNER cannot write and cannot self-reactivate (0007/0008)', async () => {
    const s = svc()
    // Manager path deactivates the owner (service_role, bypasses self-update pin).
    await s.from('profiles').update({ is_active: false }).eq('id', f.users.aOwner.id)

    const owner = f.clients.aOwner // JWT still valid, but is_active is now false

    // (a) write blocked — is_workspace_manager() is is_active-aware.
    const { data: wrote, error: wErr } = await owner
      .from('properties')
      .insert(newProp(f.workspaceA, 'deactivated-owner'))
      .select('id')
    expect(wErr !== null || (wrote ?? []).length === 0).toBe(true)

    // (b) self-reactivation blocked by the 0007 pin — 0 rows.
    const { data: react } = await owner
      .from('profiles')
      .update({ is_active: true })
      .eq('id', f.users.aOwner.id)
      .select('id')
    expect(react ?? []).toHaveLength(0)
    const { data: check } = await s
      .from('profiles')
      .select('is_active')
      .eq('id', f.users.aOwner.id)
      .single()
    expect(check?.is_active).toBe(false)

    // Restore for clean teardown / independence.
    await s.from('profiles').update({ is_active: true }).eq('id', f.users.aOwner.id)
  })
})
