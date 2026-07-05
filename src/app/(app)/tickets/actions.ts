'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import {
  ticketCreateSchema,
  ticketCommentSchema,
  ticketStatusSchema,
} from '@/lib/validation/ticket'
import {
  createTicket,
  getTicket,
  updateTicketStatus,
  assignTicket,
  getWorkspaceProfile,
} from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import { createTicketComment } from '@/lib/data/ticket-comments'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor } from '@/lib/data/vendors'
import { can } from '@/lib/auth/permissions'

export async function createTicketAction(formData: FormData) {
  // Operator create path — managers only. Tenant self-report is P3.7 with a different
  // action (created_for_user_id + PUBLIC-visibility rules), so this one gates on write.
  const user = await requirePermission('tickets:write')

  const parsed = ticketCreateSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    category: formData.get('category'),
    priority: formData.get('priority'),
    propertyId: formData.get('propertyId'),
    // '' (no unit chosen) -> undefined so the optional/nullable uuid check passes.
    unitId: (formData.get('unitId') as string | null) || undefined,
  })
  if (!parsed.success) {
    redirectWithError('/tickets/new', parsed.error.issues[0].message)
  }

  const { title, description, category, priority, propertyId, unitId } = parsed.data
  const supabase = await createClient()

  // Confirm the property belongs to this workspace (the uuid is well-formed per zod, but
  // could reference another workspace's property or a stale id).
  const property = await getProperty(supabase, user.workspaceId, propertyId)
  if (!property) {
    redirectWithError('/tickets/new', 'Selected property was not found.')
  }

  // If a unit was chosen it must exist in this workspace AND belong to the chosen
  // property — the flat unit select could otherwise pair a unit with the wrong property.
  if (unitId) {
    const unit = await getUnit(supabase, user.workspaceId, unitId)
    if (!unit || unit.property_id !== propertyId) {
      redirectWithError('/tickets/new', 'Selected unit does not belong to the chosen property.')
    }
  }

  let ticketId: string
  try {
    const ticket = await createTicket(supabase, {
      workspaceId: user.workspaceId,
      propertyId,
      unitId: unitId ?? null,
      createdByUserId: user.id,
      title,
      description,
      category,
      priority,
    })
    ticketId = ticket.id
  } catch (e) {
    // redirectWithError throws NEXT_REDIRECT, so ticketId is definitely assigned past here.
    redirectWithError('/tickets/new', e instanceof Error ? e.message : 'Could not create ticket.')
  }

  // Best-effort audit event, logged AFTER the ticket row exists via the SERVICE-ROLE
  // client (the only principal allowed to call log_ticket_event). This is wrapped in its
  // OWN try/catch that does NOT fail the action: a created ticket with a missing audit
  // event is strictly better than a 500 returned after the row is already persisted (the
  // user would retry and create a duplicate). We log the failure server-side and proceed.
  // A stricter, atomic design would move this into a DB AFTER-INSERT trigger — tracked
  // for Phase 4. This block is the template P3.6's status/assignment events mirror.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId,
      eventType: 'TICKET_CREATED',
      actorUserId: user.id,
      actorType: 'USER',
      newValueJson: { status: 'NEW', title, category, priority },
    })
  } catch (e) {
    console.error('Failed to log TICKET_CREATED event for ticket', ticketId, e)
  }

  revalidatePath('/tickets')
  redirect(`/tickets/${ticketId}`)
}

// ---------------------------------------------------------------------------
// P3.6 detail-page actions. Each is bound with the ticket id at the call site
// (`.bind(null, id)`), gates FIRST, mutates via the authenticated (RLS-bound) client,
// then logs a best-effort audit event via the service-role client — mirroring
// createTicketAction above. redirect/revalidatePath live OUTSIDE the try blocks.
// ---------------------------------------------------------------------------

export async function transitionTicketStatusAction(id: string, formData: FormData) {
  const user = await requirePermission('tickets:write')
  const detailPath = `/tickets/${id}`

  const parsed = ticketStatusSchema.safeParse({ status: formData.get('nextStatus') })
  if (!parsed.success) {
    redirectWithError(detailPath, parsed.error.issues[0].message)
  }
  const nextStatus = parsed.data.status
  const expectedCurrentStatus = formData.get('expectedCurrentStatus') as string | null

  const supabase = await createClient()
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) {
    redirectWithError(detailPath, 'Ticket not found.')
  }

  // OPTIMISTIC CONCURRENCY: the form submitted the status the user was looking at when
  // they rendered the transition button. If the ticket has moved on since (another
  // manager acted, or a second tab), the freshly-loaded status won't match — reject so
  // the user re-reads the (now-different) state before retrying, rather than applying a
  // transition that was legal against a stale view.
  if (expectedCurrentStatus && ticket.status !== expectedCurrentStatus) {
    redirectWithError(detailPath, 'This ticket changed since you loaded it; please review and retry.')
  }

  try {
    // updateTicketStatus calls assertTransition internally, so an illegal move (e.g. the
    // submitted button no longer legal for the current status) throws here and is turned
    // into a friendly error rather than a 500.
    await updateTicketStatus(supabase, user.workspaceId, id, nextStatus, ticket.status)
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not update status.')
  }

  // Single STATUS_CHANGED event for every transition (including → CLOSED). We do NOT
  // additionally emit TICKET_CLOSED: two events for one mutation would double-count the
  // audit timeline and force every reader to de-dupe. A dedicated close event is better
  // sourced from a DB trigger on closed_at in Phase 4 if a distinct close signal is ever
  // needed. Best-effort: a failed log console.errors and proceeds (the row already moved).
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      eventType: 'STATUS_CHANGED',
      actorUserId: user.id,
      actorType: 'USER',
      oldValueJson: { status: ticket.status },
      newValueJson: { status: nextStatus },
    })
  } catch (e) {
    console.error('Failed to log STATUS_CHANGED event for ticket', id, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}

export async function assignOperatorAction(id: string, formData: FormData) {
  const user = await requirePermission('tickets:assign')
  const detailPath = `/tickets/${id}`

  // Empty string (the "Unassigned" option) → null = unassign.
  const operatorId = (formData.get('operatorId') as string | null) || null

  const supabase = await createClient()
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) {
    redirectWithError(detailPath, 'Ticket not found.')
  }

  // P3.1 DEFERRED-FK CLOSE: assigned_operator_id is a plain FK to profiles(id) and does
  // NOT enforce same-workspace membership at the DB level. So before assigning, confirm
  // the target profile actually belongs to THIS workspace via getWorkspaceProfile —
  // null means "not a member here", reject. (Unassign skips this — null is always valid.)
  if (operatorId) {
    const profile = await getWorkspaceProfile(supabase, user.workspaceId, operatorId)
    if (!profile) {
      redirectWithError(detailPath, 'Selected operator is not in this workspace.')
    }
  }

  try {
    await assignTicket(supabase, user.workspaceId, id, { assignedOperatorId: operatorId })
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not assign operator.')
  }

  // DECISION: assignment does NOT auto-advance status. Assigning an operator to a
  // TRIAGE ticket leaves it TRIAGE; the manager clicks the "Mark ASSIGNED" transition
  // separately. Keeping assignment and status as two independent, independently-audited
  // actions matches assignTicket's own contract (it never touches status) and avoids a
  // hidden coupled mutation that would produce a surprising second timeline entry.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      eventType: 'OPERATOR_ASSIGNED',
      actorUserId: user.id,
      actorType: 'USER',
      oldValueJson: { assignedOperatorId: ticket.assigned_operator_id },
      newValueJson: { assignedOperatorId: operatorId },
    })
  } catch (e) {
    console.error('Failed to log OPERATOR_ASSIGNED event for ticket', id, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}

export async function assignVendorAction(id: string, formData: FormData) {
  const user = await requirePermission('tickets:assign')
  const detailPath = `/tickets/${id}`

  const vendorId = (formData.get('vendorId') as string | null) || null

  const supabase = await createClient()
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) {
    redirectWithError(detailPath, 'Ticket not found.')
  }

  // Same deferred-FK close for vendors: assigned_vendor_id is a plain FK. getVendor is
  // double-scoped by workspace_id, so a null return means the vendor isn't in this
  // workspace — reject. (getVendor doesn't filter is_active; an inactive-but-in-workspace
  // vendor is an acceptable edge for MVP — the select only offers active ones anyway.)
  if (vendorId) {
    const vendor = await getVendor(supabase, user.workspaceId, vendorId)
    if (!vendor) {
      redirectWithError(detailPath, 'Selected vendor is not in this workspace.')
    }
  }

  try {
    await assignTicket(supabase, user.workspaceId, id, { assignedVendorId: vendorId })
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not assign vendor.')
  }

  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      eventType: 'VENDOR_ASSIGNED',
      actorUserId: user.id,
      actorType: 'USER',
      oldValueJson: { assignedVendorId: ticket.assigned_vendor_id },
      newValueJson: { assignedVendorId: vendorId },
    })
  } catch (e) {
    console.error('Failed to log VENDOR_ASSIGNED event for ticket', id, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}

export async function addTicketCommentAction(id: string, formData: FormData) {
  const user = await requirePermission('tickets:write')
  const detailPath = `/tickets/${id}`

  const parsed = ticketCommentSchema.safeParse({
    body: formData.get('body'),
    visibility: formData.get('visibility'),
  })
  if (!parsed.success) {
    redirectWithError(detailPath, parsed.error.issues[0].message)
  }
  const { body, visibility } = parsed.data

  // DEFENSE-IN-DEPTH: RLS (comments_insert_own_public) already blocks a non-manager from
  // posting INTERNAL, but we reject at the app layer too so an accountant/tenant-shaped
  // caller gets a clean error instead of a raw RLS failure — and the check is explicit
  // in the audit trail of the code. tickets:write is required above; only comment-internal
  // holders may set INTERNAL.
  if (visibility === 'INTERNAL' && !can(user.role, 'tickets:comment-internal')) {
    redirectWithError(detailPath, 'You cannot post internal comments.')
  }

  const supabase = await createClient()
  try {
    await createTicketComment(supabase, {
      workspaceId: user.workspaceId,
      ticketId: id,
      authorUserId: user.id,
      body,
      visibility,
    })
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not add comment.')
  }

  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      eventType: 'COMMENT_ADDED',
      actorUserId: user.id,
      actorType: 'USER',
      metadataJson: { visibility },
    })
  } catch (e) {
    console.error('Failed to log COMMENT_ADDED event for ticket', id, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}
