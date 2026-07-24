import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnouncementStatus } from '@/types/domain'

// Row type for `public.announcements` (migration 0030, Phase 1B) — kept LOCAL to
// this data file rather than src/types/domain.ts, following the tenants (0025) /
// notifications (0026) / auth-events (0028) precedent: recently-added entities
// keep their row type beside their queries; AnnouncementStatus (the enum union)
// lives in domain.ts as every Postgres-enum-backed union in this schema does.
// property_id null = workspace-wide notice; set = targeted at one property (a
// composite FK to properties(id, workspace_id), same optional-attribution shape
// as documents.property_id, 0018).
export type Announcement = {
  id: string
  workspace_id: string
  property_id: string | null
  title: string
  body: string
  status: AnnouncementStatus
  published_at: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

/**
 * Tenant portal read (My announcements / Phase 1B). Called with the caller's OWN
 * RLS-bound client — announcements_select_published_for_tenant (migration 0030)
 * already narrows the result to PUBLISHED rows the caller is entitled to (any
 * workspace-wide row, plus property-targeted rows only where the caller holds an
 * ACTIVE tenancy in that property, via the tenant_can_read_announcement SECURITY
 * DEFINER helper). The `.eq('status', 'PUBLISHED')` + workspace scope here are
 * belt-and-suspenders over RLS — same "double-scoped, not load-bearing for the
 * security boundary" discipline as listDocuments (src/lib/data/documents.ts:74-85)
 * — not a substitute for the policy. Newest-published-first.
 */
export async function listPublishedAnnouncementsForTenant(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'PUBLISHED')
    .order('published_at', { ascending: false })
  if (error) throw error
  return data as Announcement[]
}

/**
 * A single announcement by id, same workspace + RLS scope as the list above.
 * Mirrors the getX-returns-null-on-error shape used throughout lib/data (e.g.
 * getProperty, getTenant) — a stale/foreign/not-yet-published id simply resolves
 * to null rather than throwing, so a caller (a future detail route) can render a
 * 404-style not-found instead of crashing.
 */
export async function getAnnouncement(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string
): Promise<Announcement | null> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('status', 'PUBLISHED')
    .eq('id', id)
    .single()
  if (error) return null
  return data as Announcement
}

// =============================================================================
// MANAGER COMPOSE SURFACE (the /announcements operator page). Everything below is
// gated app-side by the new announcements:read / announcements:write permissions
// (src/lib/auth/permissions.ts) and, for real enforcement, by RLS:
// announcements_select_manager_or_accountant (read, includes DRAFT) and
// announcements_insert_manager / announcements_update_manager (write,
// is_workspace_manager() only — ACCOUNTANT is read-only here, matching documents).
// =============================================================================

/**
 * Manager/accountant roster read — ALL statuses (DRAFT + PUBLISHED), own workspace,
 * newest-composed-first. Unlike listPublishedAnnouncementsForTenant above (which orders
 * by published_at, since that's what a tenant cares about), a DRAFT has no published_at
 * yet, so this orders by created_at instead. RLS narrows the actual rows returned; this
 * layer just applies workspace scope + ordering, same discipline as listDocuments.
 */
export async function listAnnouncements(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Announcement[]
}

export type CreateAnnouncementInput = {
  workspaceId: string
  createdByUserId: string
  title: string
  body: string
  // null/omitted = workspace-wide; set = targeted at one property (composite FK,
  // announcements_property_fk). The action layer re-validates the id belongs to this
  // workspace (via getProperty) before calling this, same discipline as
  // reportIssueAction's property re-check (portal/actions.ts).
  propertyId?: string | null
}

/**
 * Compose a new announcement. Always born DRAFT — mirrors createInvoice's "a new
 * invoice is born DRAFT" convention (src/lib/data/invoices.ts): a separate, explicit
 * publish step (setAnnouncementStatus below) is what makes it visible to tenants, so a
 * half-written notice never accidentally goes live mid-edit.
 */
export async function createAnnouncement(
  supabase: SupabaseClient,
  input: CreateAnnouncementInput
): Promise<Announcement> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      workspace_id: input.workspaceId,
      created_by_user_id: input.createdByUserId,
      title: input.title,
      body: input.body,
      property_id: input.propertyId ?? null,
      status: 'DRAFT',
    })
    .select()
    .single()
  if (error) throw error
  return data as Announcement
}

/**
 * Transition status (Publish / move back to Draft). Stamps published_at on entering
 * PUBLISHED and clears it on leaving — symmetric with setInvoiceStatus's paid_at
 * stamping (src/lib/data/invoices.ts), so published_at always reflects "currently
 * live", never a stale first-publish instant from an earlier publish/unpublish cycle.
 */
export async function setAnnouncementStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  status: AnnouncementStatus
): Promise<Announcement> {
  const payload: Record<string, unknown> = {
    status,
    published_at: status === 'PUBLISHED' ? new Date().toISOString() : null,
  }
  const { data, error } = await supabase
    .from('announcements')
    .update(payload)
    .eq('workspace_id', workspaceId)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Announcement
}
