import { createServiceClient } from '@/lib/supabase/service'
import { notifyTicketStatusChanged } from '@/lib/email/notify'
import { createNotification, resolveStatusChangedRecipients } from '@/lib/notifications/notify-inapp'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketStatus } from '@/types/domain'

// ---------------------------------------------------------------------------
// sendStatusChangeNotifications — the ONE status-change fan-out, shared by the
// detail-page transitionTicketStatusAction and the board's moveTicketStatusAction
// (which performed the identical transition but silently skipped every
// notification). Factored verbatim out of the detail action's two after()
// blocks; both call sites invoke this inside after() so the fan-out never
// blocks the user's redirect/response.
//
// `ticket` is the row as loaded BEFORE the transition (its .status is the
// fromStatus). Every branch is best-effort with its own try/catch, mirroring
// the blocks it was factored from — a notification hiccup can never surface to
// the caller.
// ---------------------------------------------------------------------------

export type StatusChangeNotificationInput = {
  actorUserId: string
  workspaceId: string
  /** The ticket row loaded before the transition — .status is the from-status. */
  ticket: Ticket
  nextStatus: TicketStatus
  /** The ticket detail path the in-app notification links to. */
  detailPath: string
}

export async function sendStatusChangeNotifications(
  input: StatusChangeNotificationInput
): Promise<void> {
  const { actorUserId, workspaceId, ticket, nextStatus, detailPath } = input

  // Best-effort email to the reporter (tenant filed-for, else the creator). Own
  // try/catch, service-role client for the auth.admin email lookup, never blocks the
  // caller. Disconnected-safe (no-op with no RESEND_API_KEY).
  try {
    await notifyTicketStatusChanged(createServiceClient(), {
      ticketId: ticket.id,
      workspaceId,
      title: ticket.title,
      category: ticket.category,
      priority: ticket.priority,
      reporterUserId: ticket.created_for_user_id ?? ticket.created_by_user_id,
      fromStatus: ticket.status,
      toStatus: nextStatus,
    })
  } catch (e) {
    console.error('Failed to send status-changed email for ticket', ticket.id, e)
  }

  // Best-effort in-app notification (P2-1) — fans out to BOTH created_by and
  // created_for when distinct. The email above only reaches one address (via the
  // ??-collapsed reporterUserId passed to notifyTicketStatusChanged); the in-app
  // inbox can afford to ping both real stakeholders. resolveStatusChangedRecipients
  // already excludes the actor, and createNotification independently re-checks the
  // same guard per recipient.
  try {
    const recipients = resolveStatusChangedRecipients(
      actorUserId,
      ticket.created_by_user_id,
      ticket.created_for_user_id
    )
    // Parallel — these were also written serially per recipient.
    await Promise.all(
      recipients.map((recipientUserId) =>
        createNotification(createServiceClient(), {
          workspaceId,
          recipientUserId,
          actorUserId,
          type: 'TICKET_STATUS_CHANGED',
          title: 'Ticket status changed',
          body: ticket.title,
          href: detailPath,
        })
      )
    )
  } catch (e) {
    console.error('Failed to write status-changed notification for ticket', ticket.id, e)
  }
}
