import { randomBytes, createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TicketCategory, TicketPriority, TicketStatus } from '@/types/domain'

// =============================================================================
// Vendor job tokens — the data layer behind the no-login vendor secure link (P3.8).
//
// SECURITY MODEL (see migration 0014's header for the full rationale):
//   * A vendor has NO auth.uid(). The raw token IS the entire auth boundary.
//   * generateRawToken produces 256 bits of entropy; only its SHA-256 hash is stored.
//   * The RAW TOKEN IS NEVER PERSISTED — it is returned ONCE to the generating manager
//     (so they can build the link) and then only ever presented back by the vendor, who
//     holds it in the URL. We look it up by re-hashing what the vendor presents.
//   * Every DB function here takes the SERVICE-ROLE client. vendor_job_tokens has RLS
//     enabled with ZERO policies, so it is unreachable by anon/authenticated; only the
//     service_role (which bypasses RLS, server-side only) can touch it. NEVER call these
//     with a browser-facing client, and never expose the service client to the browser.
// =============================================================================

/**
 * Generate a fresh raw capability token: 256 bits (32 bytes) of CSPRNG output as 64 hex
 * chars. Runs SERVER-SIDE ONLY (node:crypto). This is the secret the vendor holds; it is
 * returned once and never stored — only its hash is persisted.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * SHA-256 hex of a raw token. Deterministic — the same raw token always hashes to the
 * same value, which is how we look a presented token up. Preimage-resistant: a leak of
 * the stored hash does not yield the raw token.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export type VendorJobTokenRow = {
  id: string
  workspace_id: string
  ticket_id: string
  vendor_id: string
  token_hash: string
  created_by_user_id: string
  expires_at: string
  revoked_at: string | null
  accepted_at: string | null
  declined_at: string | null
  completed_at: string | null
  created_at: string
}

export type CreateVendorJobTokenInput = {
  workspaceId: string
  ticketId: string
  vendorId: string
  createdByUserId: string
  expiresInDays: number
}

/**
 * Create a vendor job token row. Generates a fresh raw token, stores ONLY its hash plus
 * an expires_at of now + expiresInDays, and returns `{ rawToken, id }`. The caller builds
 * the /job/<rawToken> link from rawToken; the raw token is returned ONCE and never
 * persisted. MUST be called with the SERVICE-ROLE client (RLS-no-policy table).
 */
export async function createVendorJobToken(
  serviceClient: SupabaseClient,
  input: CreateVendorJobTokenInput
): Promise<{ rawToken: string; id: string }> {
  const rawToken = generateRawToken()
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await serviceClient
    .from('vendor_job_tokens')
    .insert({
      workspace_id: input.workspaceId,
      ticket_id: input.ticketId,
      vendor_id: input.vendorId,
      token_hash: tokenHash,
      created_by_user_id: input.createdByUserId,
      expires_at: expiresAt,
    })
    .select()
    .single()
  if (error) throw error
  return { rawToken, id: (data as VendorJobTokenRow).id }
}

// The SANITIZED single-ticket view a vendor is allowed to see. This is the WHOLE of what
// leaves the trust boundary to a no-login holder: id/title/description/category/priority/
// status + property name + unit label + vendor company name. NOTHING ELSE — no costs, no
// internal notes, no assignee identities, no other tickets, no cross-workspace data.
export type VendorJobView = {
  token: VendorJobTokenRow
  ticket: {
    id: string
    title: string
    description: string
    category: TicketCategory
    priority: TicketPriority
    status: TicketStatus
  }
  propertyName: string | null
  unitLabel: string | null
  vendorCompanyName: string | null
}

/**
 * Validate a raw token and, if valid, return the SANITIZED single-ticket view for it.
 *
 * Returns null (no oracle — caller shows one generic "invalid or expired" page) when:
 *   * no row matches the token hash (not found / bad token), OR
 *   * revoked_at is not null (revoked / declined / completed link), OR
 *   * expires_at is in the past (expired).
 *
 * On success returns the token row plus a ticket view built from EXPLICIT column
 * selection (never select('*')) — the sanitization is the column list itself. We fetch
 * the ticket, its property name, its unit label, and the vendor's company name as
 * separate, explicitly-columned queries (rather than a PostgREST embed) so that:
 *   (a) each query names ONLY the fields that may leave the boundary, and
 *   (b) the in-memory test client (which does not model embeds) can exercise it.
 * All secondary lookups are scoped by the token's own workspace_id/ticket_id — a holder
 * cannot pivot to another ticket or workspace.
 *
 * MUST be called with the SERVICE-ROLE client.
 */
export async function getValidVendorJob(
  serviceClient: SupabaseClient,
  rawToken: string
): Promise<VendorJobView | null> {
  // A malformed/empty token can never match a stored SHA-256 hash, but short-circuit to
  // avoid a pointless query and to make the "no oracle" contract explicit.
  if (!rawToken) return null
  const tokenHash = hashToken(rawToken)

  const { data: tokenData, error: tokenError } = await serviceClient
    .from('vendor_job_tokens')
    .select(
      'id, workspace_id, ticket_id, vendor_id, token_hash, created_by_user_id, expires_at, revoked_at, accepted_at, declined_at, completed_at, created_at'
    )
    .eq('token_hash', tokenHash)
    .single()
  if (tokenError || !tokenData) return null
  const token = tokenData as VendorJobTokenRow

  // Revocation + expiry checks. revoked_at set (revoked/declined/completed) OR past
  // expiry → dead link. Fail closed.
  if (token.revoked_at) return null
  if (new Date(token.expires_at).getTime() < Date.now()) return null

  // SANITIZED ticket fetch — explicit columns only, scoped to the token's workspace +
  // its bound ticket. No costs, no assignees, no internal fields.
  const { data: ticketData, error: ticketError } = await serviceClient
    .from('tickets')
    .select('id, title, description, category, priority, status, property_id, unit_id')
    .eq('workspace_id', token.workspace_id)
    .eq('id', token.ticket_id)
    .single()
  if (ticketError || !ticketData) return null
  const t = ticketData as {
    id: string
    title: string
    description: string
    category: TicketCategory
    priority: TicketPriority
    status: TicketStatus
    property_id: string
    unit_id: string | null
  }

  // Location labels + vendor company name — each an explicit single-column select scoped
  // to the token's workspace. These are the only related fields exposed.
  const [{ data: propData }, unitResult, { data: vendorData }] = await Promise.all([
    serviceClient
      .from('properties')
      .select('name')
      .eq('workspace_id', token.workspace_id)
      .eq('id', t.property_id)
      .single(),
    t.unit_id
      ? serviceClient
          .from('units')
          .select('label')
          .eq('workspace_id', token.workspace_id)
          .eq('id', t.unit_id)
          .single()
      : Promise.resolve({ data: null }),
    serviceClient
      .from('vendors')
      .select('company_name')
      .eq('workspace_id', token.workspace_id)
      .eq('id', token.vendor_id)
      .single(),
  ])

  return {
    token,
    ticket: {
      id: t.id,
      title: t.title,
      description: t.description,
      category: t.category,
      priority: t.priority,
      status: t.status,
    },
    propertyName: (propData as { name: string } | null)?.name ?? null,
    unitLabel: (unitResult.data as { label: string } | null)?.label ?? null,
    vendorCompanyName: (vendorData as { company_name: string } | null)?.company_name ?? null,
  }
}

export type VendorJobLifecycleField = 'accepted_at' | 'declined_at' | 'completed_at'

/**
 * Stamp a lifecycle field (accepted_at / declined_at / completed_at) = now() on a token
 * row. The action layer enforces the state machine (e.g. no complete after decline) BY
 * inspecting the token row's *_at fields BEFORE calling this — this is the raw write.
 * Scoped by row id. MUST be called with the SERVICE-ROLE client.
 */
export async function markVendorJob(
  serviceClient: SupabaseClient,
  tokenRowId: string,
  field: VendorJobLifecycleField
): Promise<void> {
  const { error } = await serviceClient
    .from('vendor_job_tokens')
    .update({ [field]: new Date().toISOString() })
    .eq('id', tokenRowId)
  if (error) throw error
}

/**
 * Revoke a token row (set revoked_at = now()) so the link can never be used again. Called
 * on decline and on complete — a used capability must die. Scoped by row id. SERVICE-ROLE.
 */
export async function revokeVendorJobToken(
  serviceClient: SupabaseClient,
  tokenRowId: string
): Promise<void> {
  const { error } = await serviceClient
    .from('vendor_job_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenRowId)
  if (error) throw error
}
