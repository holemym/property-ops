import { describe, it, expect, afterEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  createNotification,
  resolveOperatorAssignedRecipient,
  resolveStatusChangedRecipients,
  resolveCommentRecipient,
} from '@/lib/notifications/notify-inapp'

// ---------------------------------------------------------------------------
// Pure recipient resolvers (P2-1 board acceptance: "recipient-resolution
// branches") — no I/O, one branch per test. Mirrors the three wiring sites in
// src/app/(app)/tickets/actions.ts.
// ---------------------------------------------------------------------------

describe('resolveOperatorAssignedRecipient', () => {
  it('notifies the newly-assigned operator', () => {
    expect(resolveOperatorAssignedRecipient('manager-1', 'operator-2')).toBe('operator-2')
  })

  it('skips when the operator assigns themselves (self-action skip)', () => {
    expect(resolveOperatorAssignedRecipient('operator-2', 'operator-2')).toBeNull()
  })

  it('skips when unassigning (no operator)', () => {
    expect(resolveOperatorAssignedRecipient('manager-1', null)).toBeNull()
  })
})

describe('resolveStatusChangedRecipients', () => {
  it('notifies created_by when created_for is not set', () => {
    expect(resolveStatusChangedRecipients('operator-1', 'tenant-1', null)).toEqual(['tenant-1'])
  })

  it('fans out to both created_by and created_for when distinct', () => {
    expect(resolveStatusChangedRecipients('operator-1', 'tenant-1', 'tenant-2')).toEqual([
      'tenant-1',
      'tenant-2',
    ])
  })

  it('dedupes when created_for equals created_by', () => {
    expect(resolveStatusChangedRecipients('operator-1', 'tenant-1', 'tenant-1')).toEqual(['tenant-1'])
  })

  it('excludes the actor from the fan-out (self-action skip) while keeping the other recipient', () => {
    // The reporter transitions their own ticket's status themselves (e.g. a manager
    // who filed a ticket on behalf of a unit they also occupy) -> no self-notify,
    // but created_for still gets notified.
    expect(resolveStatusChangedRecipients('tenant-1', 'tenant-1', 'tenant-2')).toEqual(['tenant-2'])
  })

  it('returns an empty array when the actor is the only stakeholder', () => {
    expect(resolveStatusChangedRecipients('tenant-1', 'tenant-1', null)).toEqual([])
  })
})

describe('resolveCommentRecipient', () => {
  it('notifies the reporter when someone else comments', () => {
    expect(resolveCommentRecipient('PUBLIC', 'operator-1', 'tenant-1', 'operator-1')).toBe('tenant-1')
  })

  it('notifies the assigned operator instead when the reporter comments on their own ticket', () => {
    expect(resolveCommentRecipient('PUBLIC', 'tenant-1', 'tenant-1', 'operator-1')).toBe('operator-1')
  })

  it('returns null when the reporter comments and no operator is assigned yet', () => {
    expect(resolveCommentRecipient('PUBLIC', 'tenant-1', 'tenant-1', null)).toBeNull()
  })

  it('produces no notification for an INTERNAL comment (INTERNAL comment exclusion)', () => {
    expect(resolveCommentRecipient('INTERNAL', 'operator-1', 'tenant-1', 'operator-1')).toBeNull()
  })

  it('produces no notification when the assigned operator is also the reporter and the commenter (self-action skip)', () => {
    expect(resolveCommentRecipient('PUBLIC', 'operator-1', 'operator-1', 'operator-1')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createNotification — the writer. DB-touching guards (demo workspace, missing
// recipient, actor === recipient) exercised against the in-memory fake client.
// ---------------------------------------------------------------------------

describe('createNotification', () => {
  const WORKSPACE_A = 'workspace-a'

  function rowsOf(client: ReturnType<typeof createFakeSupabaseClient>) {
    return (client as unknown as { _tables: Record<string, Record<string, unknown>[]> })._tables
      .notifications ?? []
  }

  it('writes a notification row scoped to the workspace and recipient', async () => {
    const client = createFakeSupabaseClient({ notifications: [] })
    await createNotification(client, {
      workspaceId: WORKSPACE_A,
      recipientUserId: 'user-2',
      actorUserId: 'user-1',
      type: 'TICKET_ASSIGNED',
      title: 'Ticket assigned to you',
      body: 'Leaking tap',
      href: '/tickets/t-1',
    })
    const rows = rowsOf(client)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      workspace_id: WORKSPACE_A,
      recipient_user_id: 'user-2',
      type: 'TICKET_ASSIGNED',
      title: 'Ticket assigned to you',
      body: 'Leaking tap',
      href: '/tickets/t-1',
      read_at: null,
    })
  })

  it('never writes a notification when the recipient is the actor (self-action skip)', async () => {
    const client = createFakeSupabaseClient({ notifications: [] })
    await createNotification(client, {
      workspaceId: WORKSPACE_A,
      recipientUserId: 'user-1',
      actorUserId: 'user-1',
      type: 'TICKET_ASSIGNED',
      title: 'Ticket assigned to you',
      href: '/tickets/t-1',
    })
    expect(rowsOf(client)).toHaveLength(0)
  })

  it('skips quietly when there is no recipient to notify', async () => {
    const client = createFakeSupabaseClient({ notifications: [] })
    await createNotification(client, {
      workspaceId: WORKSPACE_A,
      recipientUserId: null,
      actorUserId: 'user-1',
      type: 'TICKET_COMMENT',
      title: 'New comment',
      href: '/tickets/t-1',
    })
    expect(rowsOf(client)).toHaveLength(0)
  })

  describe('demo workspace', () => {
    const original = process.env.DEMO_WORKSPACE_ID

    afterEach(() => {
      process.env.DEMO_WORKSPACE_ID = original
    })

    it('produces no notification for the demo workspace', async () => {
      process.env.DEMO_WORKSPACE_ID = 'demo-ws'
      const client = createFakeSupabaseClient({ notifications: [] })
      await createNotification(client, {
        workspaceId: 'demo-ws',
        recipientUserId: 'user-2',
        actorUserId: 'user-1',
        type: 'TICKET_ASSIGNED',
        title: 'Ticket assigned to you',
        href: '/tickets/t-1',
      })
      expect(rowsOf(client)).toHaveLength(0)
    })
  })
})
