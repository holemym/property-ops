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
