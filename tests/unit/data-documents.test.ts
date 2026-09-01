import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { updateDocument } from '@/lib/data/documents'

const WORKSPACE_A = 'workspace-a'
const WORKSPACE_B = 'workspace-b'

// updateDocument's REPLACE semantics are the point under test: an edit restates the
// document's single attachment in full (all five refs written), so re-attaching moves
// the link and "nothing" DETACHES — the retract lever for a wrongly-shared document
// (attachment drives resident-portal visibility, RLS 0030).
describe('documents data access — update', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      documents: [
        {
          id: 'doc-1',
          workspace_id: WORKSPACE_A,
          property_id: null,
          unit_id: null,
          tenancy_id: 'tenancy-wrong',
          vendor_id: null,
          ticket_id: null,
          document_type: 'LEASE',
          title: 'Lease — Familie Berger',
          storage_path: 'workspace-a/abc-lease.pdf',
          file_type: 'application/pdf',
          file_size: 210000,
          expires_at: null,
          notes: null,
          uploaded_by_user_id: 'user-1',
          created_at: '2026-08-01T09:00:00Z',
        },
        {
          id: 'doc-2',
          workspace_id: WORKSPACE_B,
          property_id: null,
          unit_id: null,
          tenancy_id: null,
          vendor_id: null,
          ticket_id: null,
          document_type: 'OTHER',
          title: 'Other workspace doc',
          storage_path: 'workspace-b/def-file.pdf',
          file_type: 'application/pdf',
          file_size: 1000,
          expires_at: null,
          notes: null,
          uploaded_by_user_id: 'user-9',
          created_at: '2026-08-02T09:00:00Z',
        },
      ],
    })
  })

  it('re-attaches: moving the link to a unit clears the wrong tenancy link', async () => {
    const updated = await updateDocument(client, WORKSPACE_A, 'doc-1', {
      title: 'Lease — Familie Berger',
      notes: null,
      expiresAt: null,
      propertyId: null,
      unitId: 'unit-2',
      tenancyId: null,
      vendorId: null,
      ticketId: null,
    })
    expect(updated.unit_id).toBe('unit-2')
    expect(updated.tenancy_id).toBeNull()
  })

  it('detaches: all-null refs retract the document to operators only', async () => {
    const updated = await updateDocument(client, WORKSPACE_A, 'doc-1', {
      title: 'Lease — Familie Berger',
      notes: 'retracted pending review',
      expiresAt: null,
      propertyId: null,
      unitId: null,
      tenancyId: null,
      vendorId: null,
      ticketId: null,
    })
    expect(updated.property_id).toBeNull()
    expect(updated.unit_id).toBeNull()
    expect(updated.tenancy_id).toBeNull()
    expect(updated.vendor_id).toBeNull()
    expect(updated.ticket_id).toBeNull()
    expect(updated.notes).toBe('retracted pending review')
  })

  it('edits title/expiry without touching the stored object columns', async () => {
    const updated = await updateDocument(client, WORKSPACE_A, 'doc-1', {
      title: 'Lease — Familie Berger (signed)',
      notes: null,
      expiresAt: '2027-06-30',
      propertyId: null,
      unitId: null,
      tenancyId: 'tenancy-wrong',
      vendorId: null,
      ticketId: null,
    })
    expect(updated.title).toBe('Lease — Familie Berger (signed)')
    expect(updated.expires_at).toBe('2027-06-30')
    // The bytes are append-only by design: the update never writes these columns.
    expect(updated.storage_path).toBe('workspace-a/abc-lease.pdf')
    expect(updated.file_type).toBe('application/pdf')
    expect(updated.file_size).toBe(210000)
  })

  it("is workspace-scoped: cannot edit another workspace's document", async () => {
    // doc-2 lives in WORKSPACE_B; editing it AS workspace A must miss (single() -> error).
    await expect(
      updateDocument(client, WORKSPACE_A, 'doc-2', {
        title: 'hijack',
        notes: null,
        expiresAt: null,
        propertyId: null,
        unitId: null,
        tenancyId: null,
        vendorId: null,
        ticketId: null,
      })
    ).rejects.toThrow()
  })
})
