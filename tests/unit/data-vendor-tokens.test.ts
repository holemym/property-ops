import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  generateRawToken,
  hashToken,
  createVendorJobToken,
  getValidVendorJob,
  markVendorJob,
  revokeVendorJobToken,
} from '@/lib/data/vendor-tokens'

const WS_A = 'workspace-a'
const TICKET_A = 'ticket-a'
const VENDOR_A = 'vendor-a'
const MANAGER = 'manager-1'

// ---------------------------------------------------------------------------
// Pure helpers — the security-critical primitives. These have no DB dependency
// and get real coverage (entropy shape, deterministic hashing, known vector).
// ---------------------------------------------------------------------------
describe('vendor token pure helpers', () => {
  it('generateRawToken returns 64 hex chars (256 bits)', () => {
    const t = generateRawToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generateRawToken returns a different value each call (entropy)', () => {
    const a = generateRawToken()
    const b = generateRawToken()
    expect(a).not.toBe(b)
  })

  it('hashToken is deterministic', () => {
    const raw = generateRawToken()
    expect(hashToken(raw)).toBe(hashToken(raw))
  })

  it('hashToken matches a known SHA-256 vector', () => {
    // SHA-256("abc") — the canonical test vector.
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('hashToken output is a 64-char hex digest', () => {
    expect(hashToken('anything')).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// DB wrappers. These are thin service-client wrappers, so coverage is light and
// focused on the SECURITY invariants: raw token never stored, hash lookup,
// expiry/revocation rejection, sanitized field selection. Uses the in-memory fake
// client (models eq-filters + insert/update/select-single, which is all these need).
// ---------------------------------------------------------------------------
function seed() {
  return createFakeSupabaseClient({
    vendor_job_tokens: [],
    tickets: [
      {
        id: TICKET_A,
        workspace_id: WS_A,
        property_id: 'prop-a',
        unit_id: 'unit-a',
        title: 'Leaking radiator',
        description: 'Water pooling under the radiator in the hall.',
        category: 'HEATING',
        priority: 'HIGH',
        status: 'ASSIGNED',
        // Fields that MUST NOT leak into the vendor view:
        estimated_cost: 500,
        actual_cost: 480,
        assigned_operator_id: 'op-secret',
        created_by_user_id: 'tenant-secret',
      },
    ],
    properties: [{ id: 'prop-a', workspace_id: WS_A, name: 'Hauptstrasse 12' }],
    units: [{ id: 'unit-a', workspace_id: WS_A, label: 'Apt 3B' }],
    vendors: [{ id: VENDOR_A, workspace_id: WS_A, company_name: 'Acme Plumbing' }],
  })
}

describe('vendor token DB wrappers', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>
  beforeEach(() => {
    client = seed()
  })

  it('createVendorJobToken stores ONLY the hash, never the raw token', async () => {
    const { rawToken, id } = await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/)
    expect(id).toBeTruthy()

    const rows = (client as unknown as { _tables: Record<string, Array<Record<string, unknown>>> })
      ._tables.vendor_job_tokens
    expect(rows).toHaveLength(1)
    const row = rows[0]
    // The stored hash matches the raw token's SHA-256...
    expect(row.token_hash).toBe(createHash('sha256').update(rawToken).digest('hex'))
    // ...and the raw token appears in NO column of the persisted row.
    expect(JSON.stringify(row)).not.toContain(rawToken)
  })

  it('createVendorJobToken sets a future expires_at from expiresInDays', async () => {
    await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    const row = (client as unknown as { _tables: Record<string, Array<Record<string, unknown>>> })
      ._tables.vendor_job_tokens[0]
    expect(new Date(row.expires_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('getValidVendorJob returns the SANITIZED view for a valid token', async () => {
    const { rawToken } = await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    const job = await getValidVendorJob(client, rawToken)
    expect(job).not.toBeNull()
    expect(job!.ticket.title).toBe('Leaking radiator')
    expect(job!.ticket.status).toBe('ASSIGNED')
    expect(job!.propertyName).toBe('Hauptstrasse 12')
    expect(job!.unitLabel).toBe('Apt 3B')
    expect(job!.vendorCompanyName).toBe('Acme Plumbing')
    // The sanitized view exposes ONLY the allowed ticket keys — no cost/assignee leak.
    expect(Object.keys(job!.ticket).sort()).toEqual([
      'category',
      'description',
      'id',
      'priority',
      'status',
      'title',
    ])
    const flat = JSON.stringify(job!)
    expect(flat).not.toContain('500') // estimated_cost
    expect(flat).not.toContain('480') // actual_cost
    expect(flat).not.toContain('op-secret') // assigned_operator_id
    expect(flat).not.toContain('tenant-secret') // created_by_user_id
  })

  it('getValidVendorJob returns null for an unknown token (no oracle)', async () => {
    const job = await getValidVendorJob(client, 'deadbeef'.repeat(8))
    expect(job).toBeNull()
  })

  it('getValidVendorJob returns null for an empty token', async () => {
    const job = await getValidVendorJob(client, '')
    expect(job).toBeNull()
  })

  it('getValidVendorJob rejects an expired token', async () => {
    const { rawToken, id } = await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    // Force the row into the past.
    const rows = (client as unknown as { _tables: Record<string, Array<Record<string, unknown>>> })
      ._tables.vendor_job_tokens
    rows.find((r) => r.id === id)!.expires_at = new Date(Date.now() - 1000).toISOString()
    expect(await getValidVendorJob(client, rawToken)).toBeNull()
  })

  it('getValidVendorJob rejects a revoked token', async () => {
    const { rawToken, id } = await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    await revokeVendorJobToken(client, id)
    expect(await getValidVendorJob(client, rawToken)).toBeNull()
  })

  it('markVendorJob stamps a lifecycle field', async () => {
    const { rawToken, id } = await createVendorJobToken(client, {
      workspaceId: WS_A,
      ticketId: TICKET_A,
      vendorId: VENDOR_A,
      createdByUserId: MANAGER,
      expiresInDays: 7,
    })
    await markVendorJob(client, id, 'accepted_at')
    const job = await getValidVendorJob(client, rawToken)
    expect(job!.token.accepted_at).toBeTruthy()
  })
})
