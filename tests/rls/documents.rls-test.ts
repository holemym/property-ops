import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, svc, teardown, type RlsFixture } from './helpers'

// Transcribes the migration 0018 documents smoke tests (the load-bearing subset):
//   #1 a MANAGER (owner) CAN INSERT a document (documents_insert_manager);
//   #2 THE ROLE ASYMMETRY — the accountant CAN SELECT documents (read-only oversight) but
//      is REJECTED on INSERT (is_workspace_manager() EXCLUDES ACCOUNTANT — the INVERSE of
//      finance in 0017, where the accountant writes);
//   #3 tenant SELECT returns ZERO documents (role-gated, not open-select);
//   #4 cross-workspace SELECT returns ZERO of workspace A's documents (tenant isolation).
// Skips wholesale without live RLS_TEST_* creds (hasLiveCreds()).
describe.skipIf(!hasLiveCreds())('RLS: documents hub', () => {
  let f: RlsFixture

  // A storage path built the same way the server builds it (workspace-first segment). The
  // bytes are not uploaded here — these assertions exercise the METADATA table RLS, which
  // is what governs list/read/write visibility of documents.
  const pathFor = (ws: string, name: string) =>
    `${ws}/00000000-0000-0000-0000-000000000000-${name}`

  beforeAll(async () => {
    f = await setupTwoWorkspaces()

    // Seed one document in workspace A via the service client (bypasses RLS) so the
    // SELECT-visibility assertions (#2 accountant, #3 tenant, #4 cross-workspace) have a
    // real row to see-or-not-see.
    const s = svc()
    const { error } = await s.from('documents').insert({
      workspace_id: f.workspaceA,
      document_type: 'LEASE',
      title: 'Seed lease A',
      storage_path: pathFor(f.workspaceA, 'seed-lease.pdf'),
      file_type: 'application/pdf',
      file_size: 1024,
    })
    if (error) throw new Error(`seed document insert failed: ${error.message}`)
  })
  afterAll(async () => {
    await teardown(f)
  })

  // #1 — a manager (OWNER via is_workspace_manager()) owns the documents hub. The
  // documents_insert_manager WITH CHECK passes (own workspace + manager role).
  it('manager (owner) CAN INSERT a document', async () => {
    const { data, error } = await f.clients.aOwner
      .from('documents')
      .insert({
        workspace_id: f.workspaceA,
        document_type: 'CONTRACT',
        title: 'Owner-inserted contract',
        storage_path: pathFor(f.workspaceA, 'owner-contract.pdf'),
        file_type: 'application/pdf',
        file_size: 2048,
        uploaded_by_user_id: f.users.aOwner.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  // #2 — THE ROLE ASYMMETRY. The accountant gets read-only oversight on SELECT...
  it('accountant CAN SELECT documents (read-only oversight)', async () => {
    const { data, error } = await f.clients.aAccountant
      .from('documents')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  // ...but is REJECTED on INSERT (is_workspace_manager() EXCLUDES ACCOUNTANT). This is the
  // single most important assertion — documents follow the ops model, NOT the finance one.
  it('accountant INSERT of a document is REJECTED (read-only asymmetry)', async () => {
    const { data, error } = await f.clients.aAccountant
      .from('documents')
      .insert({
        workspace_id: f.workspaceA,
        document_type: 'INVOICE',
        title: 'Accountant should not write this',
        storage_path: pathFor(f.workspaceA, 'accountant-invoice.pdf'),
        file_type: 'application/pdf',
        file_size: 512,
        uploaded_by_user_id: f.users.aAccountant.id,
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  // #3 — tenants are not document-facing: role-gated SELECT returns zero rows.
  it('tenant SELECT returns ZERO documents', async () => {
    const { data } = await f.clients.aTenant1.from('documents').select('id')
    expect(data ?? []).toHaveLength(0)
  })

  // #4 — cross-workspace isolation: workspace B's owner sees ZERO of A's documents.
  it('cross-workspace SELECT returns ZERO of workspace A documents', async () => {
    const { data } = await f.clients.bOwner
      .from('documents')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(data ?? []).toHaveLength(0)
  })
})
