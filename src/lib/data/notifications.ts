import type { SupabaseClient } from '@supabase/supabase-js'
import type { NotificationType } from '@/types/domain'

// Row type for `public.notifications` (migration 0026) — kept LOCAL to this data
// file rather than src/types/domain.ts. This follows the src/lib/data/tenants.ts
// precedent (P1-1, migration 0025): the most recently added full entity in this
// schema also keeps its row type local, so this matches that live convention
// rather than the domain.ts placement used by the 0016-0021 batch (Tenancy/
// Document/IncomeRecord/ExpenseRecord/Invoice/InvoiceLineItem). NotificationType
// itself (the enum union) DOES live in domain.ts — every Postgres-enum-backed
// union in this codebase does, with no exceptions, regardless of migration number.
export type Notification = {
  id: string
  workspace_id: string
  recipient_user_id: string
  type: NotificationType
  title: string
  body: string | null
  href: string
  read_at: string | null
  created_at: string
}

export type NotificationPage = {
  rows: Notification[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const DEFAULT_PAGE_SIZE = 25

/**
 * Paginated own-inbox listing, newest-first (feeds the /notifications page, P2-2).
 * Mirrors listTicketsPage's house `.range()` pattern (src/lib/data/tickets.ts):
 * an exact count first (cheap head request) so the requested page can be clamped
 * to the available range, then just that window is fetched.
 *
 * RLS (0026, notifications_select_own) already scopes rows to the caller's own
 * inbox (recipient_user_id = auth.uid() AND workspace_id = current_workspace_id()).
 * The explicit .eq() filters below are the same "double-scoped" belt-and-braces
 * every other data-layer read in this project applies on top of RLS — not a
 * substitute for it, and not load-bearing for the security boundary.
 */
export async function listNotificationsPage(
  supabase: SupabaseClient,
  workspaceId: string,
  recipientUserId: string,
  params: { page?: number; pageSize?: number } = {}
): Promise<NotificationPage> {
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE

  // ONE round-trip: the exact count rides along with the rows (PostgREST
  // `count: 'exact'` + `.range()`), instead of a separate head-only count query.
  // Only the rare out-of-range page pays a second, clamped fetch.
  const fetchPage = async (page: number) => {
    const from = (page - 1) * pageSize
    const { data, count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('recipient_user_id', recipientUserId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    return { rows: (data ?? []) as Notification[], total: count ?? 0 }
  }

  const requested = Math.max(1, params.page ?? 1)
  let page = requested
  let { rows, total } = await fetchPage(page)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (rows.length === 0 && total > 0 && requested > pageCount) {
    page = pageCount
    ;({ rows, total } = await fetchPage(page))
  }

  return { rows, total, page, pageSize, pageCount }
}

/**
 * Unread count for the TopNav bell chip (P2-2). Fetches only `id` for matching
 * unread rows and counts in JS — same "small, bounded result set" precedent as
 * countTicketsByStatus (src/lib/data/tickets.ts): one user's unread notifications
 * is never a large set, so a head-count query would be optimizing a query that
 * is never the bottleneck, at the cost of being unexercisable by the in-memory
 * test client. Double-scoped, same rationale as listNotificationsPage above.
 */
export async function countUnread(
  supabase: SupabaseClient,
  workspaceId: string,
  recipientUserId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
  if (error) throw error
  return (data ?? []).length
}

/**
 * Mark ONE notification read. MUST be called with the caller's OWN RLS-bound
 * client (never the service client) — notifications_update_own (0026) already
 * restricts an UPDATE to the caller's own row, so the explicit workspace_id/
 * recipient_user_id filters here are defense-in-depth, not the security
 * boundary; RLS is. A stale/foreign/already-gone id simply matches zero rows
 * (no error) — same "no oracle" shape as every other own-row update in this
 * codebase's own-resource actions.
 */
export async function markRead(
  supabase: SupabaseClient,
  workspaceId: string,
  recipientUserId: string,
  id: string
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('recipient_user_id', recipientUserId)
    .eq('id', id)
  if (error) throw error
}

/**
 * Mark every UNREAD notification in the caller's own inbox read ("Mark all
 * read"). Same caller's-own-client discipline as markRead. Filters to
 * `read_at IS NULL` so already-read rows keep their original read_at instead
 * of being bumped to now() on every click.
 */
export async function markAllRead(
  supabase: SupabaseClient,
  workspaceId: string,
  recipientUserId: string
): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
  if (error) throw error
}
