import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, svc, type RlsFixture } from './helpers'

// Transcribes vendor_job_tokens zero-policy smoke tests (0014):
//   #2 (not selectable by authenticated — even OWNER), #3/#4 (expired/revoked
//   invalid per the getValidVendorJob predicate), plus the "raw token never
//   stored" invariant. App-level validation is unit-tested elsewhere; here we
//   assert the DB boundary only.
describe.skipIf(!hasLiveCreds())('RLS: vendor_job_tokens (zero-policy table)', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  const insertToken = async (hash: string, opts: { expiresAt: string; revokedAt?: string | null }) => {
    const s = svc()
    return s
      .from('vendor_job_tokens')
      .insert({
        workspace_id: f.workspaceA,
        ticket_id: f.ticketT1,
        vendor_id: f.vendorA,
        token_hash: hash,
        created_by_user_id: f.users.aOperator.id,
        expires_at: opts.expiresAt,
        revoked_at: opts.revokedAt ?? null,
      })
      .select('id, expires_at, revoked_at')
      .single()
  }

  it('service can insert a valid token; authenticated (even OWNER) reads ZERO', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { data: row, error } = await insertToken('a'.repeat(64), { expiresAt: future })
    expect(error).toBeNull()
    expect(row).not.toBeNull()

    // Owner is the highest-privileged authenticated role — still no SELECT policy.
    const { data: ownerRead } = await f.clients.aOwner.from('vendor_job_tokens').select('id')
    expect(ownerRead ?? []).toHaveLength(0)

    // Operator likewise.
    const { data: opRead } = await f.clients.aOperator.from('vendor_job_tokens').select('id')
    expect(opRead ?? []).toHaveLength(0)
  })

  it('expired + revoked tokens are recognizable as invalid via getValidVendorJob predicate', async () => {
    const s = svc()
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    await insertToken('b'.repeat(64), { expiresAt: past }) // expired
    await insertToken('c'.repeat(64), { expiresAt: future, revokedAt: new Date().toISOString() }) // revoked
    await insertToken('d'.repeat(64), { expiresAt: future }) // valid

    // Mirror getValidVendorJob's filter (expires_at > now AND revoked_at IS NULL),
    // run server-side (the only role that can read this table).
    const nowIso = new Date().toISOString()
    const { data: valid } = await s
      .from('vendor_job_tokens')
      .select('token_hash')
      .gt('expires_at', nowIso)
      .is('revoked_at', null)
    const hashes = (valid ?? []).map((r) => r.token_hash)
    expect(hashes).toContain('d'.repeat(64)) // the valid one qualifies
    expect(hashes).not.toContain('b'.repeat(64)) // expired filtered out
    expect(hashes).not.toContain('c'.repeat(64)) // revoked filtered out
  })

  it('raw token is never stored — only token_hash exists', async () => {
    const s = svc()
    const { data } = await s.from('vendor_job_tokens').select('*').limit(1).single()
    expect(data).not.toBeNull()
    expect(Object.keys(data!)).toContain('token_hash')
    // No column holds a raw token / plaintext secret.
    expect(Object.keys(data!)).not.toContain('token')
    expect(Object.keys(data!)).not.toContain('raw_token')
  })
})
