import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// Transcribes tenant ticket + comment visibility smoke tests:
//   0011 #2/#4/#5/#6/#7 (own-rows select, own insert, no update, no forging
//   created_by, status forced to NEW), 0013 #1/#2/#3 (on-behalf visibility),
//   0012 #2/#5/#6/#7 (internal-comment leak + public insert + adversarial insert).
describe.skipIf(!hasLiveCreds())('RLS: tenant tickets + comment visibility', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  it('tenant1 sees T1 (reported) + T3 (on-behalf) but NOT T2', async () => {
    const { data } = await f.clients.aTenant1.from('tickets').select('id')
    const ids = (data ?? []).map((r) => r.id)
    expect(ids).toContain(f.ticketT1)
    expect(ids).toContain(f.ticketT3)
    expect(ids).not.toContain(f.ticketT2)
  })

  it('tenant1 cannot UPDATE T1 (no tenant update policy)', async () => {
    const { data } = await f.clients.aTenant1
      .from('tickets')
      .update({ status: 'CLOSED' })
      .eq('id', f.ticketT1)
      .select('id')
    expect(data ?? []).toHaveLength(0)
  })

  it('tenant1 cannot forge created_by = tenant2 on insert (0011 #6)', async () => {
    const { data, error } = await f.clients.aTenant1
      .from('tickets')
      .insert({
        workspace_id: f.workspaceA,
        property_id: f.propertyA,
        created_by_user_id: f.users.aTenant2.id, // someone else
        title: 'forged',
        description: 'should be rejected',
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('tenant1 insert with status=CLOSED lands as NEW (before-insert trigger)', async () => {
    const { data, error } = await f.clients.aTenant1
      .from('tickets')
      .insert({
        workspace_id: f.workspaceA,
        property_id: f.propertyA,
        created_by_user_id: f.users.aTenant1.id,
        title: 'tenant self-report',
        description: 'tries to self-close',
        status: 'CLOSED',
      })
      .select('id, status')
      .single()
    expect(error).toBeNull()
    expect(data?.status).toBe('NEW') // trigger sanitized the tenant's status
  })

  it('INTERNAL comment on T1 is INVISIBLE to tenant1; PUBLIC is visible (0012 #2)', async () => {
    const s = svc()
    // Service inserts an INTERNAL + a PUBLIC comment on T1 (authored by operator).
    await s.from('ticket_comments').insert([
      {
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        author_user_id: f.users.aOperator.id,
        body: 'internal staff note',
        visibility: 'INTERNAL',
      },
      {
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        author_user_id: f.users.aOperator.id,
        body: 'public reply to tenant',
        visibility: 'PUBLIC',
      },
    ])

    const { data } = await f.clients.aTenant1
      .from('ticket_comments')
      .select('body, visibility')
      .eq('ticket_id', f.ticketT1)
    const visibilities = (data ?? []).map((c) => c.visibility)
    expect(visibilities).toContain('PUBLIC')
    expect(visibilities).not.toContain('INTERNAL')
  })

  it('tenant1 CAN post a PUBLIC comment on own T1; INTERNAL is rejected (0012 #5/#6)', async () => {
    const t1 = f.clients.aTenant1
    const { data: pub, error: pubErr } = await t1
      .from('ticket_comments')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        author_user_id: f.users.aTenant1.id,
        body: 'tenant public comment',
        visibility: 'PUBLIC',
      })
      .select('id')
    expect(pubErr).toBeNull()
    expect((pub ?? []).length).toBe(1)

    const { data: internal, error: intErr } = await t1
      .from('ticket_comments')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        author_user_id: f.users.aTenant1.id,
        body: 'tenant tries internal',
        visibility: 'INTERNAL',
      })
      .select('id')
    expect(intErr !== null || (internal ?? []).length === 0).toBe(true)
  })

  it('tenant1 cannot post a comment on T2 (not owned) — 0012 #7', async () => {
    const { data, error } = await f.clients.aTenant1
      .from('ticket_comments')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT2,
        author_user_id: f.users.aTenant1.id,
        body: 'intruding on tenant2 ticket',
        visibility: 'PUBLIC',
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })
})
