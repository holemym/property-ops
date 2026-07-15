import type { SupabaseClient } from '@supabase/supabase-js'
import type { CommentVisibility, NotificationType } from '@/types/domain'
import { isDemoWorkspace } from '@/lib/demo'

// ---------------------------------------------------------------------------
// notify-inapp — the in-app notification writer (P2). Mirrors the discipline of
// src/lib/email/notify.ts: best-effort, NEVER throws, console.error on failure,
// so a notification hiccup can never fail the ticket action that triggered it.
//
// Unlike email there is no env-key "disconnected" gate — writes go straight to
// the `notifications` table (migration 0026). That table has a ZERO INSERT
// POLICY: only the service-role client (which bypasses RLS) can write it, so
// `serviceClient` below MUST be the service-role client
// (src/lib/supabase/service.ts). An RLS-bound authenticated client's insert
// would not error — PostgREST would just silently write zero rows, which is a
// much worse failure mode than a thrown error, so this is called out loudly
// here and at every call site.
//
// Wired into src/app/(app)/tickets/actions.ts at three sites: operator-assign,
// status-change, and comment-added (spec
// docs/superpowers/specs/2026-07-12-property-ops-p2-notifications-design.md §2).
// ---------------------------------------------------------------------------

export type CreateNotificationInput = {
  workspaceId: string
  // The user this notification is FOR. null/undefined -> skip quietly (mirrors
  // notify.ts's resolveUserEmail null-skip: an unresolvable recipient is not an
  // error, just nothing to do). Callers typically pass the output of one of the
  // resolve*Recipient(s) functions below.
  recipientUserId: string | null | undefined
  // The user who performed the action that triggered this notification.
  actorUserId: string | null | undefined
  type: NotificationType
  title: string
  body?: string | null
  href: string
}

/**
 * Write one in-app notification. Best-effort: NEVER throws — a DB failure is
 * caught and console.error'd, exactly like notify.ts's email functions.
 *
 * Guards, in order:
 *   1. Demo workspace -> skip entirely (spec §2: visitors share anon identities
 *      across resets; a persisted notification would be nonsense there, and
 *      reset_demo_workspace() wipes the table anyway — this just avoids the
 *      pointless write).
 *   2. No recipient -> skip (nothing to notify).
 *   3. recipient === actor -> **never notify the actor about their own
 *      action** (spec §2, explicit). This is a second, independent backstop on
 *      top of the resolve*Recipient(s) functions below, which already exclude
 *      the actor — belt-and-braces, the same defense-in-depth style as
 *      addTicketCommentAction's INTERNAL gate (checked at both RLS and the
 *      app layer).
 */
export async function createNotification(
  serviceClient: SupabaseClient,
  input: CreateNotificationInput
): Promise<void> {
  if (isDemoWorkspace(input.workspaceId)) return
  if (!input.recipientUserId) return
  if (input.recipientUserId === input.actorUserId) return

  try {
    const { error } = await serviceClient.from('notifications').insert({
      workspace_id: input.workspaceId,
      recipient_user_id: input.recipientUserId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href,
      read_at: null,
    })
    if (error) {
      console.error('[notify-inapp] failed to write notification', input.type, error)
    }
  } catch (e) {
    console.error('[notify-inapp] createNotification threw', input.type, e)
  }
}

// ---------------------------------------------------------------------------
// Pure recipient resolvers — no I/O, so these are the unit-testable core (P2-1
// board acceptance: "recipient-resolution branches"). Each mirrors one of the
// three wiring sites in src/app/(app)/tickets/actions.ts.
// ---------------------------------------------------------------------------

/**
 * TICKET_ASSIGNED: notify the newly-assigned operator, unless they assigned
 * themselves. Returns null when there is no one to notify (unassign, or
 * self-assign) — callers should not write a notification in that case.
 */
export function resolveOperatorAssignedRecipient(
  actorUserId: string,
  operatorUserId: string | null
): string | null {
  if (!operatorUserId || operatorUserId === actorUserId) return null
  return operatorUserId
}

/**
 * TICKET_STATUS_CHANGED: notify created_by AND created_for, if set and
 * distinct from created_by — a fan-out of up to two recipients (spec §2,
 * point 2). The actor is excluded from the result (a manager transitioning
 * their own self-filed ticket never notifies themselves). Deduped and
 * order-stable (created_by first).
 */
export function resolveStatusChangedRecipients(
  actorUserId: string,
  createdByUserId: string,
  createdForUserId: string | null
): string[] {
  const recipients: string[] = []
  if (createdByUserId !== actorUserId) recipients.push(createdByUserId)
  if (
    createdForUserId &&
    createdForUserId !== createdByUserId &&
    createdForUserId !== actorUserId
  ) {
    recipients.push(createdForUserId)
  }
  return recipients
}

/**
 * TICKET_COMMENT: PUBLIC only — an INTERNAL comment must never surface a
 * notification (that would leak its existence to a reporter who cannot see
 * INTERNAL comments at all; spec §2, point 3). When PUBLIC: notify the
 * reporter, unless the commenter IS the reporter, in which case notify the
 * assigned operator instead (there is no one else to tell). Returns null when
 * there is nobody to notify (INTERNAL comment, or the reporter commented and
 * no operator is assigned yet).
 */
export function resolveCommentRecipient(
  visibility: CommentVisibility,
  actorUserId: string,
  reporterUserId: string,
  assignedOperatorId: string | null
): string | null {
  if (visibility !== 'PUBLIC') return null
  if (actorUserId === reporterUserId) {
    return assignedOperatorId && assignedOperatorId !== actorUserId ? assignedOperatorId : null
  }
  return reporterUserId
}
