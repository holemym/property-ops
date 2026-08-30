import { formatDateTime } from '@/lib/format-date'
import { Bell, CheckCheck, MessageSquare, RefreshCw, UserCheck, type LucideIcon } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listNotificationsPage, countUnread, type Notification } from '@/lib/data/notifications'
import { statusBadge } from '@/lib/status'
import { relativeDay } from '@/lib/relative-date'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Pagination } from '@/components/common/Pagination'
import { Card } from '@/components/ui/card'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { markReadNotificationAction, markAllReadNotificationsAction } from './actions'
import { toneClasses } from '@/components/ui/badge'
import type { NotificationType } from '@/types/domain'

// P0-4: replaced the monochrome tone dot with a distinct glyph per notification type —
// far more scannable at a glance. Tone still carries the "how urgent" signal (mirrors
// TICKET_STATUS's tone assignment for the same conceptual event); the glyph carries
// "what kind." Icon chip uses the same subtle bg-tint + readable text pairing as
// StatusBadge's tone variants (src/components/ui/badge.tsx) so the color system stays
// one convention, just applied to a small icon circle instead of a pill.
const NOTIFICATION_ICON: Record<NotificationType, LucideIcon> = {
  TICKET_ASSIGNED: UserCheck,
  TICKET_STATUS_CHANGED: RefreshCw,
  TICKET_COMMENT: MessageSquare,
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
      {/* markAllRead surfaces failures via ?error= — without this toast the message
          landed in the URL and was never shown (the only action-hosting page that
          lacked it). */}
      <ErrorToast />
      <PageHeader
        title="Notifications"
        subtitle="Updates on tickets you're following, in one inbox."
        actions={
          unreadCount > 0 && (
            <form action={markAllReadNotificationsAction}>
              <Button type="submit" variant="outline" size="sm">
                <CheckCheck className="size-4" />
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
          {/* ONE child (the ul) so the Card's own gap-(--card-spacing) never applies —
              multiple direct children rendered each row as a gapped island with a
              floating divider (the skeleton showed the contiguous look, so the page
              visibly shifted when data landed). ul/li also restores list semantics
              for screen readers, matching every peer list-in-card. */}
          <Card className="p-0">
            <ul className="divide-y divide-border">
              {page.rows.map((n) => (
                <li key={n.id}>
                  <NotificationRow notification={n} />
                </li>
              ))}
            </ul>
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
  const Icon = NOTIFICATION_ICON[n.type]

  return (
    <form action={markReadNotificationAction.bind(null, n.id, n.href)}>
      <button
        type="submit"
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          unread && 'bg-muted/40',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
            toneClasses[tone],
          )}
          aria-hidden
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm text-foreground', unread && 'font-semibold')}>
            {n.title}
          </span>
          {n.body && <span className="mt-0.5 block text-sm text-muted-foreground">{n.body}</span>}
        </span>
        <span
          className="shrink-0 text-xs text-muted-foreground"
          title={formatDateTime(n.created_at)}
        >
          {relativeDay(n.created_at)}
        </span>
      </button>
    </form>
  )
}
