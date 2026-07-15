import { isTenantRole } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

/**
 * Translate a stored notification href for the CURRENT viewer's role (P2-2
 * "portal-surface check" — discovered while wiring the /notifications row click, not
 * called out explicitly in the P2 spec).
 *
 * Every href written by notify-inapp's three call sites in
 * src/app/(app)/tickets/actions.ts is an OPERATOR path — `/tickets/<id>` — because the
 * writer (P2-1) never looked up the recipient's role; the href was inert (stored only,
 * never rendered as a link) until P2-2 made it clickable. But tenants/guests can never
 * reach `/tickets/*`: that route gates on the `tickets:read` permission
 * (src/app/(app)/tickets/[id]/page.tsx), which TENANT/GUEST hold zero of
 * (src/lib/auth/permissions.ts), so requirePermission throws and the click would crash
 * via the default error boundary instead of landing the tenant on their own ticket.
 * Tenants have their own equivalent at `/portal/<id>`
 * (src/app/(app)/portal/[id]/page.tsx), which resolves the SAME ticket id, RLS-scoped to
 * created_by OR created_for (tickets_select_own, migration 0013) — exactly the two
 * recipients resolveStatusChangedRecipients fans a status-changed notification out to.
 *
 * Every v1 NotificationType is ticket-related (TICKET_ASSIGNED/STATUS_CHANGED/COMMENT —
 * src/types/domain.ts) and every href currently written is `/tickets/<id>`, so a plain
 * prefix swap is complete for now. A future notification type with a non-ticket href
 * would need a new case here rather than assuming the blanket swap still applies.
 */
export function resolveNotificationHref(href: string, role: Role): string {
  const TICKETS_PREFIX = '/tickets/'
  if (isTenantRole(role) && href.startsWith(TICKETS_PREFIX)) {
    return `/portal/${href.slice(TICKETS_PREFIX.length)}`
  }
  return href
}
