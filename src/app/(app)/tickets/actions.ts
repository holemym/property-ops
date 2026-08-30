'use server'

import { redirect } from 'next/navigation'
import { after } from 'next/server'
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
import { runAutoTriage } from '@/lib/ai/triage-service'
import {
  notifyTicketStatusChanged,
  notifyOperatorAssigned,
  notifyVendorAssigned,
  notifyVendorJobLink,
  notifyTicketCreated,
} from '@/lib/email/notify'
import {
  createNotification,
  resolveOperatorAssignedRecipient,
  resolveStatusChangedRecipients,
  resolveCommentRecipient,
} from '@/lib/notifications/notify-inapp'
import { createVendorJobToken } from '@/lib/data/vendor-tokens'
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

  // AI ticket triage (Phase 4) — best-effort, non-blocking. Suggests a category/priority
  // and writes an internal note + AI_CLASSIFICATION_GENERATED event. DISCONNECTED BY
  // DEFAULT: with no ANTHROPIC_API_KEY set, this runs a deterministic offline heuristic
  // (zero cost, no API call). Add the key (+ `npm i @anthropic-ai/sdk`) to switch to a
  // Claude Haiku classification. runAutoTriage swallows its own errors, so triage can
  // never fail the create — awaited here only so the suggestion note is present when the
  // manager lands on the detail page.
  // Runs AFTER the response (next/server after()): with ANTHROPIC_API_KEY set this is
  // a 1-3s Claude call, and it was serialized onto the hottest write path — the manager
  // waited out the classification just to get redirected. The suggestion note now
  // appears on the detail page's next load instead of its first paint.
  after(() =>
    runAutoTriage(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId,
      createdByUserId: user.id,
      title,
      description,
      filedCategory: category,
      filedPriority: priority,
    })
  )

  // Best-effort confirmation email to the tenant a ticket was filed ON BEHALF OF. This
  // operator-create path does not currently set created_for_user_id (it's always null
  // here), so notifyTicketCreated resolves no recipient and skips quietly — the wiring is
  // in place for the P3.7 tenant-self-report / file-on-behalf path that will set it.
  // Own try/catch, never blocks the redirect. Disconnected-safe.
  const createdForUserId = (parsed.data as { createdForUserId?: string | null }).createdForUserId ?? null
  if (createdForUserId) {
    after(async () => {
      try {
        await notifyTicketCreated(createServiceClient(), {
          ticketId,
          workspaceId: user.workspaceId,
          title,
          category,
          priority,
          reporterUserId: createdForUserId,
        })
      } catch (e) {
        console.error('Failed to send ticket-created email for ticket', ticketId, e)
      }
    })
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

  // Best-effort email to the reporter (tenant filed-for, else the creator). Mirrors the
  // audit block: own try/catch, service-role client for the auth.admin email lookup,
  // never blocks the redirect. Disconnected-safe (no-op with no RESEND_API_KEY).
  after(async () => {
    try {
      await notifyTicketStatusChanged(createServiceClient(), {
        ticketId: id,
        workspaceId: user.workspaceId,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        reporterUserId: ticket.created_for_user_id ?? ticket.created_by_user_id,
        fromStatus: ticket.status,
        toStatus: nextStatus,
      })
    } catch (e) {
      console.error('Failed to send status-changed email for ticket', id, e)
    }
  })

  // Best-effort in-app notification (P2-1) — fans out to BOTH created_by and
  // created_for when distinct. The email above only reaches one address (via the
  // ??-collapsed reporterUserId passed to notifyTicketStatusChanged); the in-app
  // inbox can afford to ping both real stakeholders. resolveStatusChangedRecipients
  // already excludes the actor, and createNotification independently re-checks the
  // same guard per recipient.
  after(async () => {
    try {
      const recipients = resolveStatusChangedRecipients(
        user.id,
        ticket.created_by_user_id,
        ticket.created_for_user_id
      )
      // Parallel — these were also written serially per recipient.
      await Promise.all(
        recipients.map((recipientUserId) =>
          createNotification(createServiceClient(), {
            workspaceId: user.workspaceId,
            recipientUserId,
            actorUserId: user.id,
            type: 'TICKET_STATUS_CHANGED',
            title: 'Ticket status changed',
            body: ticket.title,
            href: detailPath,
          })
        )
      )
    } catch (e) {
      console.error('Failed to write status-changed notification for ticket', id, e)
    }
  })

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

  // Best-effort email to the newly-assigned operator. Only on an ASSIGN (operatorId set);
  // an unassign (null) has no recipient to notify. Email resolved via auth.admin.
  // Post-response (after()): the email path is an auth.admin lookup + a mail-API
  // call — two network hops the assign click no longer waits out.
  if (operatorId) {
    after(async () => {
      try {
        await notifyOperatorAssigned(createServiceClient(), {
          ticketId: id,
          workspaceId: user.workspaceId,
          title: ticket.title,
          category: ticket.category,
          priority: ticket.priority,
          operatorUserId: operatorId,
        })
      } catch (e) {
        console.error('Failed to send operator-assigned email for ticket', id, e)
      }

      // Best-effort in-app notification (P2-1) — same ASSIGN-only guard.
      // resolveOperatorAssignedRecipient returns null on a self-assign;
      // createNotification independently re-checks the same guard.
      try {
        await createNotification(createServiceClient(), {
          workspaceId: user.workspaceId,
          recipientUserId: resolveOperatorAssignedRecipient(user.id, operatorId),
          actorUserId: user.id,
          type: 'TICKET_ASSIGNED',
          title: 'Ticket assigned to you',
          body: ticket.title,
          href: detailPath,
        })
      } catch (e) {
        console.error('Failed to write operator-assigned notification for ticket', id, e)
      }
    })
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
  // Declared at function scope so the post-assign notification can reuse the loaded row
  // (its email column) without a second query.
  let vendor: Awaited<ReturnType<typeof getVendor>> = null
  if (vendorId) {
    vendor = await getVendor(supabase, user.workspaceId, vendorId)
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

  // Best-effort heads-up email to the newly-assigned vendor (the secure job link is a
  // separate action). Only on an ASSIGN; the vendor object (with its email column) was
  // loaded above during the in-workspace check.
  if (vendorId && vendor) {
    after(async () => {
      try {
        await notifyVendorAssigned({
          ticketId: id,
          workspaceId: user.workspaceId,
          title: ticket.title,
          category: ticket.category,
          priority: ticket.priority,
          vendorEmail: vendor.email,
          vendorName: vendor.contact_name ?? vendor.company_name,
        })
      } catch (e) {
        console.error('Failed to send vendor-assigned email for ticket', id, e)
      }
    })
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}

/**
 * Generate a vendor SECURE JOB LINK for an assigned vendor (P3.8).
 *
 * Gates on tickets:assign (only a manager who can dispatch vendors may mint a link). The
 * ticket must already have an assigned_vendor_id — you can only hand a link to the vendor
 * that is actually on the job — and that vendor must be in-workspace (getVendor). We then
 * mint a hashed capability token (createVendorJobToken via the SERVICE-ROLE client, the
 * only principal that may write the RLS-no-policy vendor_job_tokens table), and hand the
 * ONE-TIME raw token back to the manager by redirecting to the detail page with a
 * ?joblink= param, where the page renders the copyable full link.
 *
 * ONE-TIME-URL EXPOSURE — DELIBERATE, DOCUMENTED: the raw token appears once in the
 * MANAGER'S OWN browser URL (and their history). This is acceptable: the manager is a
 * trusted principal generating the link for themselves to copy and send. It is NOT stored
 * anywhere (only the hash is), and it is never shown to any other user.
 *
 * PHASE 4 EMAIL DELIVERY (this file): when connected (RESEND_API_KEY set), the full job
 * link is now ALSO emailed straight to the vendor's own address via notifyVendorJobLink
 * below — the vendor no longer depends on the manager copy-pasting from the URL. The
 * ?joblink= redirect is kept as the manager's own copyable fallback (and is the only
 * delivery path while disconnected, where the email is a logging no-op).
 */
export async function generateVendorLinkAction(id: string) {
  const user = await requirePermission('tickets:assign')
  const detailPath = `/tickets/${id}`

  const supabase = await createClient()
  const ticket = await getTicket(supabase, user.workspaceId, id)
  if (!ticket) {
    redirectWithError(detailPath, 'Ticket not found.')
  }

  // A link is a capability FOR THE ASSIGNED VENDOR. No vendor assigned → nothing to
  // authorize; make the manager assign one first.
  if (!ticket.assigned_vendor_id) {
    redirectWithError(detailPath, 'Assign a vendor before generating a job link.')
  }

  // Confirm the assigned vendor is really in this workspace (defense-in-depth over the
  // composite FK — the token insert would also reject a cross-workspace pair, but we give
  // a clean error rather than a raw FK failure).
  const vendor = await getVendor(supabase, user.workspaceId, ticket.assigned_vendor_id)
  if (!vendor) {
    redirectWithError(detailPath, 'Assigned vendor is not in this workspace.')
  }

  let rawToken: string
  try {
    // SERVICE-ROLE client: vendor_job_tokens has RLS enabled with zero policies, so the
    // authenticated (RLS-bound) client cannot write it. Authorization already happened
    // above (requirePermission + in-workspace ticket + in-workspace vendor).
    const result = await createVendorJobToken(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      vendorId: ticket.assigned_vendor_id,
      createdByUserId: user.id,
      expiresInDays: 7,
    })
    rawToken = result.rawToken
  } catch (e) {
    // redirectWithError throws NEXT_REDIRECT, so rawToken is definitely assigned past here.
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not generate job link.')
  }

  // Best-effort audit event. We reuse the existing VENDOR_ASSIGNED enum value (no new
  // TicketEventType invented) with metadata marking the link-generation action, mirroring
  // the best-effort logging pattern used by the other detail actions.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId: id,
      eventType: 'VENDOR_ASSIGNED',
      actorUserId: user.id,
      actorType: 'USER',
      metadataJson: { action: 'job_link_generated', vendorId: ticket.assigned_vendor_id },
    })
  } catch (e) {
    console.error('Failed to log job_link_generated event for ticket', id, e)
  }

  // HIGHEST-VALUE NOTIFICATION: email the full secure job link straight to the vendor,
  // so delivery no longer depends on the manager copy-pasting the ?joblink= URL. The link
  // is `${NEXT_PUBLIC_SITE_URL}/job/<rawToken>` — the exact path the /job/[token] route
  // serves. Best-effort: own try/catch, never blocks the redirect. Disconnected-safe.
  after(async () => {
    try {
      const base = process.env.NEXT_PUBLIC_SITE_URL
      const jobUrl = base ? `${base}/job/${rawToken}` : `/job/${rawToken}`
      await notifyVendorJobLink({
        ticketId: id,
        workspaceId: user.workspaceId,
        title: ticket.title,
        category: ticket.category,
        priority: ticket.priority,
        vendorEmail: vendor.email,
        vendorName: vendor.contact_name ?? vendor.company_name,
        jobUrl,
      })
    } catch (e) {
      console.error('Failed to send vendor job-link email for ticket', id, e)
    }
  })

  // The raw token is ALSO returned to the manager ONCE via their own URL (fallback, and
  // the sole delivery path while email is disconnected — see docstring).
  redirect(`${detailPath}?joblink=${encodeURIComponent(rawToken)}`)
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

  // Best-effort in-app notification (P2-1) — NEW, no email sibling for comments
  // (notify.ts covers five other moments but never comments). PUBLIC only: an
  // INTERNAL comment's existence must never leak via notification, mirroring the
  // INTERNAL visibility gate above. Needs the ticket's reporter/assigned-operator,
  // which this action doesn't otherwise load — fetched here, scoped to its own
  // try/catch so a lookup failure only costs the notification, never the comment
  // that has already been saved.
  after(async () => {
    try {
      // Service client, not the request-scoped one: after() runs post-response, where
      // the cookie-bound client may no longer read its request context. The query is
      // still pinned to user.workspaceId, and the caller already passed the RLS check
      // for this ticket by writing the comment above.
      const ticket = await getTicket(createServiceClient(), user.workspaceId, id)
      if (ticket) {
        const reporterUserId = ticket.created_for_user_id ?? ticket.created_by_user_id
        const recipientUserId = resolveCommentRecipient(
          visibility,
          user.id,
          reporterUserId,
          ticket.assigned_operator_id
        )
        await createNotification(createServiceClient(), {
          workspaceId: user.workspaceId,
          recipientUserId,
          actorUserId: user.id,
          type: 'TICKET_COMMENT',
          title: 'New comment',
          body: ticket.title,
          href: detailPath,
        })
      }
    } catch (e) {
      console.error('Failed to write comment notification for ticket', id, e)
    }
  })

  revalidatePath(detailPath)
  redirect(detailPath)
}
