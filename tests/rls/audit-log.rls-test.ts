import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// Transcribes ticket_events append-only + insert-authorization smoke tests (0012):
//   #11 (manager insert OK, tenant insert blocked), #12 (no update/delete —
//   trigger raises), #15 + the 0012 revoke (tenant rpc('log_ticket_event')
//   rejected because EXECUTE is revoked from authenticated; service_role OK).
describe.skipIf(!hasLiveCreds())('RLS: ticket_events audit log (append-only)', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  it('manager (operator) CAN insert a ticket_events row', async () => {
    const { data, error } = await f.clients.aOperator
      .from('ticket_events')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        actor_user_id: f.users.aOperator.id,
        event_type: 'STATUS_CHANGED',
      })
      .select('id')
    expect(error).toBeNull()
    expect((data ?? []).length).toBe(1)
  })

  it('tenant CANNOT insert a ticket_events row directly (manager-only policy)', async () => {
    const { data, error } = await f.clients.aTenant1
      .from('ticket_events')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        actor_user_id: f.users.aTenant1.id,
        event_type: 'STATUS_CHANGED',
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('an existing event cannot be UPDATED or DELETED (no-mutation trigger)', async () => {
    const s = svc()
    const { data: ev } = await s
      .from('ticket_events')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        event_type: 'NOTE_ADDED',
      })
      .select('id')
      .single()
    const eventId = ev!.id as string

    // Even the service-role path is blocked by the trigger (it RAISES for every role).
    const { error: upErr } = await s
      .from('ticket_events')
      .update({ event_type: 'STATUS_CHANGED' })
      .eq('id', eventId)
    expect(upErr).not.toBeNull()

    const { error: delErr } = await s.from('ticket_events').delete().eq('id', eventId)
    expect(delErr).not.toBeNull()
  })

  it('tenant rpc(log_ticket_event) is REJECTED (EXECUTE revoked from authenticated)', async () => {
    const { error } = await f.clients.aTenant1.rpc('log_ticket_event', {
      p_workspace_id: f.workspaceA,
      p_ticket_id: f.ticketT1,
      p_event_type: 'COMMENT_ADDED',
      p_actor_user_id: f.users.aTenant1.id,
    })
    expect(error).not.toBeNull()
  })

  it('service_role CAN call log_ticket_event (the definer funnel)', async () => {
    const { error } = await svc().rpc('log_ticket_event', {
      p_workspace_id: f.workspaceA,
      p_ticket_id: f.ticketT1,
      p_event_type: 'COMMENT_ADDED',
      p_actor_user_id: f.users.aTenant1.id,
      p_actor_type: 'USER',
    })
    expect(error).toBeNull()
  })
})
