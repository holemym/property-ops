'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireWorkspace } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { markRead, markAllRead } from '@/lib/data/notifications'
import { resolveNotificationHref } from '@/lib/notifications/resolve-href'

// ---------------------------------------------------------------------------
// P2-2 — /notifications actions. SECURITY-CRITICAL: both mutations below call
// markRead/markAllRead (src/lib/data/notifications.ts) with createClient() — the
// CALLER'S OWN RLS-bound client — never createServiceClient(). The own-inbox UPDATE
// policy (notifications_update_own, migration 0026) is what actually constrains a
// user to their own notifications; calling these with the service client would
// bypass that and let anyone mark anyone's notifications read. (Contrast with
// createNotification in notify-inapp.ts, which correctly MUST use the service
// client — that write has a zero-policy table. Reads/updates here are the opposite
// case: the RLS-bound client is the one that's safe.)
// ---------------------------------------------------------------------------

/**
 * Row click on /notifications: mark the notification read, then redirect to its
 * target. Marking read is best-effort and never blocks the redirect — the user's
 * intent in clicking is "take me to my ticket," and a transient failure to flip
 * read_at is invisible (self-heals on the next visit to the inbox) and should not
 * strand the user on an error instead of the page they clicked through to.
 *
 * `href` is bound from the row already rendered to THIS caller from their own
 * RLS-scoped listNotificationsPage() result (not user-supplied), so it is
 * effectively first-party — every href currently written is a same-app relative
 * path (`/tickets/<id>`, src/app/(app)/tickets/actions.ts). The startsWith('/')
 * guard is cheap defense-in-depth against ever redirect()-ing to an absolute URL.
 *
 * resolveNotificationHref translates an operator `/tickets/<id>` href to the
 * tenant-reachable `/portal/<id>` equivalent when the caller is a tenant/guest —
 * see that function's docstring for why (tenants 403 on /tickets/*).
 */
export async function markReadNotificationAction(id: string, href: string) {
  const user = await requireWorkspace()
  const supabase = await createClient()

  try {
    await markRead(supabase, user.workspaceId, user.id, id)
  } catch (e) {
    console.error('Failed to mark notification read', id, e)
  }

  revalidatePath('/notifications')

  const target = resolveNotificationHref(href, user.role)
  redirect(target.startsWith('/') ? target : '/notifications')
}

/**
 * "Mark all read" (PageHeader action). Unlike the row click above, this IS the
 * entire point of the click (no secondary navigation to protect), so a genuine
 * failure is surfaced the same way setUserActive does
 * (src/app/(app)/settings/users/actions.ts) rather than swallowed.
 */
export async function markAllReadNotificationsAction() {
  const user = await requireWorkspace()
  const supabase = await createClient()

  try {
    await markAllRead(supabase, user.workspaceId, user.id)
  } catch (e) {
    console.error('Failed to mark all notifications read', e)
    redirectWithError('/notifications', 'Could not mark all as read.')
  }

  revalidatePath('/notifications')
}
