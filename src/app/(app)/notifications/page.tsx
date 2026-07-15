import { Bell } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listNotificationsPage, countUnread, type Notification } from '@/lib/data/notifications'
import { statusBadge, type StatusTone } from '@/lib/status'
import { relativeDay } from '@/lib/relative-date'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Pagination } from '@/components/common/Pagination'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { markReadNotificationAction, markAllReadNotificationsAction } from './actions'

// Solid dot color per tone — a small-mark exception to StatusBadge's tint-pair pill
// convention (src/components/ui/badge.tsx), mirroring TicketTable's PRIORITY_SPINE
// precedent (src/components/tickets/TicketTable.tsx): a flat, non-dark-mode-adjusted
// Tailwind -500 accent is already accepted for small marks like a left spine border.
// 'neutral'/'muted' share one plain gray dot since neither is a saturated status tone.
const TONE_DOT: Record<StatusTone, string> = {
  neutral: 'bg-muted-foreground/40',
  muted: 'bg-muted-foreground/40',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  // No permission gate beyond auth (spec §3: "reachable by tenant role... RLS scopes
  // rows") — requireWorkspace only, never requirePermission. listNotificationsPage /
  // countUnread are additionally double-scoped to workspaceId + recipientUserId on top
  // of RLS, so this page shows exactly the caller's own inbox regardless of role.
  const user = await requireWorkspace()
  const { page: rawPage } = await searchParams
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? '1', 10) || 1)

  const supabase = await createClient()
  const [page, unreadCount] = await Promise.all([
    listNotificationsPage(supabase, user.workspaceId, user.id, { page: requestedPage }),
    // Separate from the page's own rows: this page can be paged, so "any unread at
    // all" (which gates the Mark all read action below) must come from the full
    // inbox, not just the 25 rows currently on screen.
    countUnread(supabase, user.workspaceId, user.id),
  ])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        subtitle="Updates on tickets you're following, in one inbox."
        actions={
          unreadCount > 0 && (
            <form action={markAllReadNotificationsAction}>
              <Button type="submit" variant="outline" size="sm">
                Mark all read
              </Button>
            </form>
          )
        }
      />

      {page.total === 0 ? (
        <EmptyState
          icon={<Bell />}
          title="You're all caught up"
          body="Ticket assignments, status changes, and comments will show up here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="divide-y p-0">
            {page.rows.map((n) => (
              <NotificationRow key={n.id} notification={n} />
            ))}
          </Card>
          <Pagination
            page={page.page}
            pageCount={page.pageCount}
            total={page.total}
            baseParams={{}}
            basePath="/notifications"
          />
        </div>
      )}
    </div>
  )
}

// Each row IS the form + submit button (not a <Link>): a click must mark the
// notification read before navigating (spec §3), which a plain link can't do. The
// button fills the row (w-full, text-left) so the whole row is one click target and
// one keyboard stop, mirroring the settings/users activate/deactivate row-form
// pattern (src/app/(app)/settings/users/page.tsx) and the CommandPalette's
// full-width row buttons.
function NotificationRow({ notification: n }: { notification: Notification }) {
  const unread = n.read_at === null
  const { tone } = statusBadge('notification_type', n.type)

  return (
    <form action={markReadNotificationAction.bind(null, n.id, n.href)}>
      <button
        type="submit"
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent',
          unread && 'bg-muted/40',
        )}
      >
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm text-foreground', unread && 'font-semibold')}>
            {n.title}
          </span>
          {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
        </span>
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={new Date(n.created_at).toLocaleString()}
        >
          {relativeDay(n.created_at)}
        </span>
      </button>
    </form>
  )
}
