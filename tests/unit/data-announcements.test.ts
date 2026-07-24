import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listPublishedAnnouncementsForTenant, getAnnouncement } from '@/lib/data/announcements'

const WS_A = 'workspace-a'
const WS_B = 'workspace-b'

function announcement(overrides: Record<string, unknown>) {
  return {
    workspace_id: WS_A,
    property_id: null,
    title: 'Notice',
    body: 'Something to tell residents.',
    status: 'PUBLISHED',
    published_at: '2026-01-01T00:00:00Z',
    created_by_user_id: 'u1',
    ...overrides,
  }
}

describe('announcements data access (tenant portal read)', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      announcements: [
        announcement({ id: 'a-1', title: 'Elevator maintenance', published_at: '2026-01-05T00:00:00Z' }),
        announcement({ id: 'a-2', title: 'Older notice', published_at: '2026-01-01T00:00:00Z' }),
        // A DRAFT must never surface via the tenant read helper, even as a
        // belt-and-suspenders app-layer filter alongside the RLS pin.
        announcement({ id: 'a-draft', title: 'Not yet published', status: 'DRAFT', published_at: null }),
        // Another workspace's announcement must never leak.
        announcement({ id: 'a-other-ws', workspace_id: WS_B, title: 'Other workspace notice' }),
      ],
    })
  })

  it('lists only PUBLISHED announcements for the workspace, newest-published-first', async () => {
    const result = await listPublishedAnnouncementsForTenant(client, WS_A)
    expect(result.map((a) => a.id)).toEqual(['a-1', 'a-2'])
  })

  it('excludes DRAFT announcements', async () => {
    const result = await listPublishedAnnouncementsForTenant(client, WS_A)
    expect(result.map((a) => a.id)).not.toContain('a-draft')
  })

  it('never leaks another workspace\'s announcement', async () => {
    const result = await listPublishedAnnouncementsForTenant(client, WS_A)
    expect(result.map((a) => a.id)).not.toContain('a-other-ws')
  })

  it('getAnnouncement returns a single published row', async () => {
    const a = await getAnnouncement(client, WS_A, 'a-1')
    expect(a?.title).toBe('Elevator maintenance')
  })

  it('getAnnouncement returns null for a DRAFT (not yet visible)', async () => {
    expect(await getAnnouncement(client, WS_A, 'a-draft')).toBeNull()
  })

  it('getAnnouncement returns null for an unknown id', async () => {
    expect(await getAnnouncement(client, WS_A, 'nonexistent')).toBeNull()
  })
})
