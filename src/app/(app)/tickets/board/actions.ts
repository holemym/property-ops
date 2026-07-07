'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission } from '@/lib/auth/session'
import { ticketStatusSchema } from '@/lib/validation/ticket'
import { getTicket, updateTicketStatus } from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import { canTransition } from '@/lib/tickets/status-flow'

/**
 * Board-specific transition action (P-board).
 *
 * The existing detail-page `transitionTicketStatusAction` reports outcome by REDIRECTING
 * (redirectWithError / redirect), which is the right shape for a form submit that reloads
 * the detail page — but wrong for the kanban board's drag-and-drop, where the client wants
 * an optimistic move and a rejection to snap the card back with a toast. Redirecting would
 * blow away the board state on every drop.
 *
 * So this is a THIN wrapper over the SAME underlying transition logic
 * (updateTicketStatus, which calls assertTransition internally = the state machine is never
 * bypassed) that RETURNS a plain result object instead of redirecting. It re-gates on
 * `tickets:write`, re-loads the ticket server-side (never trusts the client's idea of the
 * current status), and does the same best-effort STATUS_CHANGED audit event as the detail
 * action. The compare-and-swap in updateTicketStatus (`.eq('status', currentStatus)`) still
 * closes the concurrency window.
 */
export type TransitionResult =
  | { ok: true; status: string }
  | { ok: false; error: string }

export async function moveTicketStatusAction(
  ticketId: string,
  nextStatusRaw: string,
): Promise<TransitionResult> {
  const user = await requirePermission('tickets:write')

  const parsed = ticketStatusSchema.safeParse({ status: nextStatusRaw })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message }
  }
  const nextStatus = parsed.data.status

  const supabase = await createClient()
  const ticket = await getTicket(supabase, user.workspaceId, ticketId)
  if (!ticket) {
    return { ok: false, error: 'Ticket not found.' }
  }

  // Guard against the client offering an illegal target BEFORE we attempt the write. The
  // state machine is the authority: a drop onto a lane not reachable from the ticket's
  // (server-loaded) current status is rejected with a friendly message. updateTicketStatus
  // would also throw via assertTransition, but checking here yields a clean error string.
  if (!canTransition(ticket.status, nextStatus)) {
    return {
      ok: false,
      error: `Can't move from ${ticket.status.replace(/_/g, ' ').toLowerCase()} to ${nextStatus
        .replace(/_/g, ' ')
        .toLowerCase()}.`,
    }
  }

  try {
    await updateTicketStatus(supabase, user.workspaceId, ticketId, nextStatus, ticket.status)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not update status.' }
  }

  // Best-effort audit event — mirrors transitionTicketStatusAction. A failed log never
  // fails the move (the row already advanced); it is console.error'd and we proceed.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId,
      eventType: 'STATUS_CHANGED',
      actorUserId: user.id,
      actorType: 'USER',
      oldValueJson: { status: ticket.status },
      newValueJson: { status: nextStatus },
    })
  } catch (e) {
    console.error('Failed to log STATUS_CHANGED event for ticket', ticketId, e)
  }

  revalidatePath('/tickets/board')
  revalidatePath('/tickets')
  revalidatePath(`/tickets/${ticketId}`)
  return { ok: true, status: nextStatus }
}
