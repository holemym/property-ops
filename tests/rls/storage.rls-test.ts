import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// DECISION: implemented as REAL upload/download attempts (not skip-with-note).
// The harness is concise — the authed clients already exist, and the storage.objects
// RLS is the single most important isolation boundary for file bytes, so it earns a
// live check. Transcribes 0015 storage smoke tests #8/#9/#10/#13:
//   - manager can upload+download under X/... ;
//   - tenant who owns T1 can download X/T1/... but NOT X/T2/... ;
//   - a user in X cannot read an object under B's workspace folder (outermost lock);
//   - service_role bypasses.
//
// Requires a Storage bucket named `attachments` on the disposable project. If the
// bucket is absent the first upload errors and the suite fails loudly (by design —
// that's a real misconfiguration to surface), rather than silently passing.
describe.skipIf(!hasLiveCreds())('RLS: storage.objects path-keyed isolation', () => {
  let f: RlsFixture
  const BUCKET = 'attachments'
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // "PNG" magic-ish
  let pathT1: string // X/T1/x.png  (owned by tenant1)
  let pathT2: string // X/T2/x.png  (owned by tenant2)

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
    pathT1 = `${f.workspaceA}/${f.ticketT1}/x.png`
    pathT2 = `${f.workspaceA}/${f.ticketT2}/y.png`
    // Ensure the bucket exists (service-role); ignore "already exists".
    await svc().storage.createBucket(BUCKET, { public: false }).catch(() => {})
  })
  afterAll(async () => {
    // Remove any objects we created, then tear down data.
    await svc()
      .storage.from(BUCKET)
      .remove([pathT1, pathT2])
      .catch(() => {})
    await teardown(f)
  })

  it('manager (operator) can upload an object under its workspace folder', async () => {
    const { error } = await f.clients.aOperator.storage
      .from(BUCKET)
      .upload(pathT1, bytes, { contentType: 'image/png', upsert: true })
    expect(error).toBeNull()
  })

  it('tenant1 (owns T1) CAN download X/T1/... ; tenant2 CANNOT', async () => {
    const { data: ok, error: okErr } = await f.clients.aTenant1.storage
      .from(BUCKET)
      .download(pathT1)
    expect(okErr).toBeNull()
    expect(ok).not.toBeNull()

    // tenant2 does not own T1 and is not a manager → blocked.
    const { data: bad, error: badErr } = await f.clients.aTenant2.storage
      .from(BUCKET)
      .download(pathT1)
    expect(badErr !== null || bad === null).toBe(true)
  })

  it('cross-workspace: B-owner CANNOT download an object under A workspace folder', async () => {
    const { data, error } = await f.clients.bOwner.storage.from(BUCKET).download(pathT1)
    expect(error !== null || data === null).toBe(true)
  })

  it('tenant1 CANNOT upload/read an object for T2 (a ticket they do not own)', async () => {
    // Upload attempt under a not-owned ticket folder → blocked by insert policy.
    const { error: upErr } = await f.clients.aTenant1.storage
      .from(BUCKET)
      .upload(pathT2, bytes, { contentType: 'image/png', upsert: true })
    expect(upErr).not.toBeNull()

    // Even if service seeds an object under T2, tenant1 cannot read it.
    await svc().storage.from(BUCKET).upload(pathT2, bytes, { contentType: 'image/png', upsert: true })
    const { data, error } = await f.clients.aTenant1.storage.from(BUCKET).download(pathT2)
    expect(error !== null || data === null).toBe(true)
  })

  it('service_role bypasses storage RLS entirely', async () => {
    const { data, error } = await svc().storage.from(BUCKET).download(pathT1)
    expect(error).toBeNull()
    expect(data).not.toBeNull()
  })
})
