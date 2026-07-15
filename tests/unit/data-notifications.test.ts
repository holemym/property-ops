import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listNotificationsPage, countUnread, markRead, markAllRead } from '@/lib/data/notifications'

const WS_A = 'workspace-a'
const WS_B = 'workspace-b'
const USER_1 = 'user-1'
const USER_2 = 'user-2'

function seed() {
  return createFakeSupabaseClient({
    notifications: [
      { id: 'n-1', workspace_id: WS_A, recipient_user_id: USER_1, type: 'TICKET_ASSIGNED', title: 'Ticket assigned to you', body: 'Leaking tap', href: '/tickets/t-1', read_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 'n-2', workspace_id: WS_A, recipient_user_id: USER_1, type: 'TICKET_STATUS_CHANGED', title: 'Ticket status changed', body: 'No heating', href: '/tickets/t-2', read_at: '2026-01-02T12:00:00Z', created_at: '2026-01-02T00:00:00Z' },
      // Different recipient, same workspace — must never leak into USER_1's inbox.
      { id: 'n-3', workspace_id: WS_A, recipient_user_id: USER_2, type: 'TICKET_COMMENT', title: 'New comment', body: 'Broken window', href: '/tickets/t-3', read_at: null, created_at: '2026-01-03T00:00:00Z' },
      // Same recipient id, different workspace — must never leak either.
      { id: 'n-4', workspace_id: WS_B, recipient_user_id: USER_1, type: 'TICKET_ASSIGNED', title: 'Other workspace', body: null, href: '/tickets/t-9', read_at: null, created_at: '2026-01-04T00:00:00Z' },
    ],
  })
}

describe('notifications data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>
  beforeEach(() => {
    client = seed()
  })

  it('lists only the recipient\'s own-workspace notifications, newest first', async () => {
    const page = await listNotificationsPage(client, WS_A, USER_1)
    expect(page.rows.map((n) => n.id)).toEqual(['n-2', 'n-1'])
    expect(page.total).toBe(2)
    expect(page.page).toBe(1)
    expect(page.pageCount).toBe(1)
  })

  it('never leaks another workspace\'s notification even for the same recipient id', async () => {
    const page = await listNotificationsPage(client, WS_A, USER_1)
    expect(page.rows.map((n) => n.id)).not.toContain('n-4')
  })

  it('never leaks another recipient\'s notification within the same workspace', async () => {
    const page = await listNotificationsPage(client, WS_A, USER_1)
    expect(page.rows.map((n) => n.id)).not.toContain('n-3')
  })

  it('clamps an out-of-range page to the last available page', async () => {
    const page = await listNotificationsPage(client, WS_A, USER_1, { page: 99, pageSize: 25 })
    expect(page.page).toBe(1)
    expect(page.rows).toHaveLength(2)
  })

  it('countUnread counts only unread rows for this recipient', async () => {
    expect(await countUnread(client, WS_A, USER_1)).toBe(1) // n-1 only (n-2 is read)
    expect(await countUnread(client, WS_A, USER_2)).toBe(1) // n-3
  })

  it('countUnread never crosses into another workspace', async () => {
    expect(await countUnread(client, WS_B, USER_1)).toBe(1) // n-4, distinct from WS_A's count
  })

  it('markRead sets read_at on the target row only, leaving siblings untouched', async () => {
    await markRead(client, WS_A, USER_1, 'n-1')
    expect(await countUnread(client, WS_A, USER_1)).toBe(0)
    expect(await countUnread(client, WS_A, USER_2)).toBe(1) // n-3 untouched
  })

  it('markRead is a no-op for a notification belonging to another recipient', async () => {
    await markRead(client, WS_A, USER_1, 'n-3') // n-3 belongs to USER_2
    expect(await countUnread(client, WS_A, USER_2)).toBe(1) // still unread
  })

  it('markAllRead clears every unread row for the recipient without touching other recipients', async () => {
    await markAllRead(client, WS_A, USER_1)
    expect(await countUnread(client, WS_A, USER_1)).toBe(0)
    expect(await countUnread(client, WS_A, USER_2)).toBe(1) // untouched
  })

  it('markAllRead does not disturb an already-read row\'s original read_at', async () => {
    await markAllRead(client, WS_A, USER_1)
    const page = await listNotificationsPage(client, WS_A, USER_1)
    const n2 = page.rows.find((n) => n.id === 'n-2')
    expect(n2?.read_at).toBe('2026-01-02T12:00:00Z')
  })
})
