'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import {
  getValidVendorJob,
  markVendorJob,
  revokeVendorJobToken,
  type VendorJobView,
} from '@/lib/data/vendor-tokens'
import { updateTicketStatus, assignTicket } from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import type { TicketStatus } from '@/types/domain'

// =============================================================================
// Vendor secure-link actions (P3.8). A vendor has NO session — the raw token in the URL
// is the ENTIRE auth boundary. EVERY action:
//   1. Re-validates the token FIRST (getValidVendorJob: hash + expiry + not-revoked,
//      single-ticket-bound) via the SERVICE-ROLE client. Invalid → redirect to the
//      generic invalid page (no oracle).
//   2. Enforces the lifecycle state machine via the token row's *_at fields
//      (double-action guards: can't accept twice, can't complete a declined job, etc.).
//   3. Mutates the ticket via updateTicketStatus/assignTicket (legal transitions only —
//      assertTransition wraps illegal moves into a friendly error) with the SAME service
//      client.
//   4. Best-effort audit event (metadata {via:'vendor_token'}) so vendor actions are
//      attributable in the timeline even though there is no actor profile.
//   5. Redirects back to /job/<token>.
//
// The service client is used because there is no authenticated vendor for RLS to key off;
// the token validation IS the authorization. It is never exposed to the browser.
// =============================================================================

function jobPath(token: string): string {
  return `/job/${token}`
}

function redirectJobError(token: string, message: string): never {
  redirect(`${jobPath(token)}?error=${encodeURIComponent(message)}`)
}

// Load + validate the token, or redirect. Returns the sanitized job view for the caller.
async function requireJob(
  serviceClient: ReturnType<typeof createServiceClient>,
  token: string
): Promise<VendorJobView> {
  const job = await getValidVendorJob(serviceClient, token)
  if (!job) {
    // No oracle: a bad/expired/revoked token all land on the same generic invalid page.
    redirect(jobPath(token))
  }
  return job
}

// True if the vendor has already taken a terminal/initial lifecycle action on this token.
function alreadyActed(job: VendorJobView): boolean {
  return Boolean(job.token.accepted_at || job.token.declined_at || job.token.completed_at)
}

export async function acceptJobAction(token: string) {
  const service = createServiceClient()
  const job = await requireJob(service, token)

  // Double-action guard: only a fresh (un-acted) token may be accepted.
  if (alreadyActed(job)) {
    redirectJobError(token, 'This job has already been responded to.')
  }

  // Move the ticket into IN_PROGRESS if the current status legally allows it (ASSIGNED /
  // SCHEDULED → IN_PROGRESS per the status-flow). If it's in some other state, we still
  // record acceptance but leave status untouched rather than forcing an illegal move.
  const status = job.ticket.status as TicketStatus
  if (status === 'ASSIGNED' || status === 'SCHEDULED') {
    try {
      await updateTicketStatus(service, job.token.workspace_id, job.token.ticket_id, 'IN_PROGRESS', status)
    } catch {
      // Concurrency/illegal-transition drift — surface a friendly error, do not mark.
      redirectJobError(token, 'This job could not be accepted right now; please reload.')
    }
  }

  await markVendorJob(service, job.token.id, 'accepted_at')

  try {
    await appendTicketEvent(service, {
      workspaceId: job.token.workspace_id,
      ticketId: job.token.ticket_id,
      eventType: 'STATUS_CHANGED',
      actorUserId: null,
      actorType: 'AUTOMATION',
      newValueJson: { status: 'IN_PROGRESS' },
      metadataJson: { via: 'vendor_token', action: 'accepted', vendorId: job.token.vendor_id },
    })
  } catch (e) {
    console.error('Failed to log vendor accept event for ticket', job.token.ticket_id, e)
  }

  revalidatePath(jobPath(token))
  redirect(jobPath(token))
}

export async function declineJobAction(token: string) {
  const service = createServiceClient()
  const job = await requireJob(service, token)

  if (alreadyActed(job)) {
    redirectJobError(token, 'This job has already been responded to.')
  }

  // Unassign the vendor — they declined the work, so they should no longer be on the
  // ticket. (Status is left as-is; a manager re-triages and re-dispatches.)
  try {
    await assignTicket(service, job.token.workspace_id, job.token.ticket_id, { assignedVendorId: null })
  } catch {
    redirectJobError(token, 'This job could not be declined right now; please reload.')
  }

  await markVendorJob(service, job.token.id, 'declined_at')
  // REVOKE: a declined link must never be reusable.
  await revokeVendorJobToken(service, job.token.id)

  try {
    await appendTicketEvent(service, {
      workspaceId: job.token.workspace_id,
      ticketId: job.token.ticket_id,
      eventType: 'VENDOR_ASSIGNED',
      actorUserId: null,
      actorType: 'AUTOMATION',
      oldValueJson: { assignedVendorId: job.token.vendor_id },
      newValueJson: { assignedVendorId: null },
      metadataJson: { via: 'vendor_token', action: 'declined', vendorId: job.token.vendor_id },
    })
  } catch (e) {
    console.error('Failed to log vendor decline event for ticket', job.token.ticket_id, e)
  }

  revalidatePath(jobPath(token))
  redirect(jobPath(token))
}

export async function completeJobAction(token: string) {
  const service = createServiceClient()
  const job = await requireJob(service, token)

  // Must be accepted, and not already declined or completed.
  if (!job.token.accepted_at) {
    redirectJobError(token, 'Accept the job before marking it complete.')
  }
  if (job.token.declined_at || job.token.completed_at) {
    redirectJobError(token, 'This job has already been responded to.')
  }

  // Move to RESOLVED if the ticket is currently IN_PROGRESS (the only legal → RESOLVED
  // source). Otherwise record completion without forcing an illegal transition.
  const status = job.ticket.status as TicketStatus
  if (status === 'IN_PROGRESS') {
    try {
      await updateTicketStatus(service, job.token.workspace_id, job.token.ticket_id, 'RESOLVED', status)
    } catch {
      redirectJobError(token, 'This job could not be completed right now; please reload.')
    }
  }

  await markVendorJob(service, job.token.id, 'completed_at')
  // REVOKE: the job is done — the link should not be reusable.
  await revokeVendorJobToken(service, job.token.id)

  try {
    await appendTicketEvent(service, {
      workspaceId: job.token.workspace_id,
      ticketId: job.token.ticket_id,
      eventType: 'STATUS_CHANGED',
      actorUserId: null,
      actorType: 'AUTOMATION',
      newValueJson: { status: 'RESOLVED' },
      metadataJson: { via: 'vendor_token', action: 'completed', vendorId: job.token.vendor_id },
    })
  } catch (e) {
    console.error('Failed to log vendor complete event for ticket', job.token.ticket_id, e)
  }

  revalidatePath(jobPath(token))
  redirect(jobPath(token))
}

// -----------------------------------------------------------------------------
// addVendorUpdateAction — DEFERRED (see the page/report for the full defense).
//
// The vendor free-text-update path is intentionally NOT implemented in this MVP. Its
// natural home is a PUBLIC comment on the ticket, but public.ticket_comments.author_user_id
// is `NOT NULL references profiles(id)` and the comment RLS policies pin authorship to
// auth.uid(). A vendor has NO profile row and no auth.uid(), so there is no HONEST
// author_user_id to write. The two ways to force it — (a) misattribute the comment to the
// manager/reporter, or (b) relax the NOT-NULL FK that the security-critical comment
// policies depend on — are both worse than deferring: (a) lies in the audit trail; (b) is
// schema churn on a security-sensitive table inside a maximum-scrutiny gate. Vendors can
// still accept / decline / complete, which is the core loop. Vendor comments are a Phase-4
// item (a proper vendor-authored-comment column or nullable author + a vendor marker).
// -----------------------------------------------------------------------------
