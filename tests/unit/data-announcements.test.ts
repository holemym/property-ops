import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  listPublishedAnnouncementsForTenant,
  getAnnouncement,
  listAnnouncements,
  createAnnouncement,
  setAnnouncementStatus,
  updateAnnouncement,
} from '@/lib/data/announcements'

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

  it("never leaks another workspace's announcement", async () => {
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

describe('announcements data access (manager compose surface)', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      announcements: [
        announcement({ id: 'a-published', title: 'Published notice', status: 'PUBLISHED' }),
        announcement({ id: 'a-draft', title: 'Draft notice', status: 'DRAFT', published_at: null }),
        announcement({ id: 'a-other-ws', workspace_id: WS_B, title: 'Other workspace notice' }),
      ],
    })
  })

  it('listAnnouncements returns every status (DRAFT + PUBLISHED) for the workspace', async () => {
    const result = await listAnnouncements(client, WS_A)
    expect(result.map((a) => a.id).sort()).toEqual(['a-draft', 'a-published'])
  })

  it("listAnnouncements never leaks another workspace's announcement", async () => {
    const result = await listAnnouncements(client, WS_A)
    expect(result.map((a) => a.id)).not.toContain('a-other-ws')
  })

  it('createAnnouncement always creates a DRAFT regardless of caller input', async () => {
    const created = await createAnnouncement(client, {
      workspaceId: WS_A,
      createdByUserId: 'manager-1',
      title: 'New notice',
      body: 'Please note the elevator is under maintenance.',
    })
    expect(created.status).toBe('DRAFT')
    expect(created.property_id).toBeNull()
    expect(created.title).toBe('New notice')
  })

  it('createAnnouncement stores an explicit property scope', async () => {
    const created = await createAnnouncement(client, {
      workspaceId: WS_A,
      createdByUserId: 'manager-1',
      title: 'Targeted notice',
      body: 'For one building only.',
      propertyId: 'prop-1',
    })
    expect(created.property_id).toBe('prop-1')
  })

  it('setAnnouncementStatus stamps published_at when entering PUBLISHED', async () => {
    const updated = await setAnnouncementStatus(client, WS_A, 'a-draft', 'PUBLISHED')
    expect(updated.status).toBe('PUBLISHED')
    expect(updated.published_at).not.toBeNull()
  })

  it('setAnnouncementStatus clears published_at when leaving PUBLISHED', async () => {
    const updated = await setAnnouncementStatus(client, WS_A, 'a-published', 'DRAFT')
    expect(updated.status).toBe('DRAFT')
    expect(updated.published_at).toBeNull()
  })
})

describe('announcements data access (edit in place)', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      announcements: [
        announcement({
          id: 'a-live',
          title: 'Elevator maintenance',
          body: 'The elevator will be serviced on Friday.',
          published_at: '2026-08-01T10:00:00Z',
        }),
        announcement({ id: 'a-other-ws', workspace_id: WS_B, title: 'Other workspace notice' }),
      ],
    })
  })

  it('edits title/body/property in place WITHOUT touching status or published_at', async () => {
    const updated = await updateAnnouncement(client, WS_A, 'a-live', {
      title: 'Elevator maintenance — new date',
      body: 'Moved to Monday.',
      propertyId: 'prop-1',
    })
    expect(updated.title).toBe('Elevator maintenance — new date')
    expect(updated.body).toBe('Moved to Monday.')
    expect(updated.property_id).toBe('prop-1')
    // The publish/draft flip stays its own explicit action — an edit never flips it.
    expect(updated.status).toBe('PUBLISHED')
    expect(updated.published_at).toBe('2026-08-01T10:00:00Z')
  })

  it('can restate the audience back to workspace-wide (property_id null)', async () => {
    await updateAnnouncement(client, WS_A, 'a-live', {
      title: 'Elevator maintenance',
      body: 'Same text.',
      propertyId: 'prop-1',
    })
    const cleared = await updateAnnouncement(client, WS_A, 'a-live', {
      title: 'Elevator maintenance',
      body: 'Same text.',
      propertyId: null,
    })
    expect(cleared.property_id).toBeNull()
  })

  it("is workspace-scoped: cannot edit another workspace's announcement", async () => {
    // a-other-ws lives in WS_B; editing it AS workspace A must miss (single() -> error).
    await expect(
      updateAnnouncement(client, WS_A, 'a-other-ws', {
        title: 'hijack',
        body: 'hijack',
        propertyId: null,
      })
    ).rejects.toThrow()
  })
})
