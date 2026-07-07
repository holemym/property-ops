import type { SupabaseClient } from '@supabase/supabase-js'
import type { TicketCategory, TicketPriority, TicketStatus } from '@/types/domain'
import { sendEmail } from './send'
import {
  ticketStatusChangedEmail,
  operatorAssignedEmail,
  vendorAssignedEmail,
  vendorJobLinkEmail,
  ticketCreatedEmail,
  type TicketRef,
} from './templates'

// ---------------------------------------------------------------------------
// notify* — the high-level, best-effort notification layer (Phase 4).
//
// Each function resolves the recipient's email, builds a template, and calls
// sendEmail. Every one is wrapped so it NEVER throws — a notification failure
// logs and returns, exactly like runAutoTriage. The ticket actions await these
// only for ordering; a send hiccup can never fail the user's action or block a
// redirect. Disconnected-safe: with no RESEND_API_KEY, sendEmail is a logging
// no-op, so these run at zero cost.
//
// RECIPIENT EMAIL RESOLUTION (multi-tenant):
//  - USERS (reporters, operators): the `profiles` table has NO email column —
//    email lives in auth.users. We resolve it via the service-role Auth Admin API
//    (createServiceClient().auth.admin.getUserById). Callers pass the service client.
//  - VENDORS: the `vendors` table has its own `email` column — callers pass it in.
//
// These accept already-loaded domain data / ids from the actions and do NOT
// re-query heavily (one admin lookup per user recipient at most).
// ---------------------------------------------------------------------------

// Shared context every notification carries about the ticket being acted on.
export type TicketContext = {
  ticketId: string
  title: string
  category?: TicketCategory
  priority?: TicketPriority
  propertyName?: string | null
}

// Build the ticket detail deep-link, if a site URL is configured. Returns null when
// NEXT_PUBLIC_SITE_URL is unset so the template omits the button rather than linking
// to "undefined/tickets/...".
function ticketUrl(ticketId: string): string | null {
  const base = process.env.NEXT_PUBLIC_SITE_URL
  return base ? `${base}/tickets/${ticketId}` : null
}

function toTicketRef(ctx: TicketContext): TicketRef {
  return {
    ticketId: ctx.ticketId,
    title: ctx.title,
    category: ctx.category,
    priority: ctx.priority,
    propertyName: ctx.propertyName ?? null,
    ticketUrl: ticketUrl(ctx.ticketId),
  }
}

/**
 * Resolve a workspace user's email via the service-role Auth Admin API. profiles has
 * no email column, so auth.users is the source of truth. Returns null (never throws)
 * when the id is missing, the lookup fails, or the user has no email — the caller then
 * skips the send quietly.
 */
async function resolveUserEmail(
  serviceClient: SupabaseClient,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null
  try {
    const { data, error } = await serviceClient.auth.admin.getUserById(userId)
    if (error) {
      console.error('[email] could not resolve user email for', userId, error)
      return null
    }
    return data.user?.email ?? null
  } catch (e) {
    console.error('[email] getUserById threw for', userId, e)
    return null
  }
}

// --- Public notify* functions ----------------------------------------------

/** Notify the ticket's reporter that its status changed. */
export async function notifyTicketStatusChanged(
  serviceClient: SupabaseClient,
  input: TicketContext & {
    reporterUserId: string | null | undefined
    fromStatus: TicketStatus
    toStatus: TicketStatus
  }
): Promise<void> {
  try {
    const to = await resolveUserEmail(serviceClient, input.reporterUserId)
    if (!to) return
    const { subject, html, text } = ticketStatusChangedEmail({
      ...toTicketRef(input),
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
    })
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    console.error('[email] notifyTicketStatusChanged failed for ticket', input.ticketId, e)
  }
}

/** Notify a newly-assigned operator. */
export async function notifyOperatorAssigned(
  serviceClient: SupabaseClient,
  input: TicketContext & {
    operatorUserId: string | null | undefined
    operatorName?: string | null
  }
): Promise<void> {
  try {
    const to = await resolveUserEmail(serviceClient, input.operatorUserId)
    if (!to) return
    const { subject, html, text } = operatorAssignedEmail({
      ...toTicketRef(input),
      operatorName: input.operatorName ?? null,
    })
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    console.error('[email] notifyOperatorAssigned failed for ticket', input.ticketId, e)
  }
}

/**
 * Notify a newly-assigned vendor (heads-up only — the secure job link is a separate
 * step). Vendor email comes from the vendors.email column; caller passes it directly.
 */
export async function notifyVendorAssigned(
  input: TicketContext & {
    vendorEmail: string | null | undefined
    vendorName?: string | null
  }
): Promise<void> {
  try {
    const to = (input.vendorEmail ?? '').trim()
    if (!to) return
    const { subject, html, text } = vendorAssignedEmail({
      ...toTicketRef(input),
      vendorName: input.vendorName ?? null,
    })
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    console.error('[email] notifyVendorAssigned failed for ticket', input.ticketId, e)
  }
}

/**
 * Email the full, secure job link to the vendor — the high-value notification that
 * replaces exposing the raw token in the manager's browser URL. Vendor email comes
 * from vendors.email; the full link is built by the caller from the raw token.
 */
export async function notifyVendorJobLink(
  input: TicketContext & {
    vendorEmail: string | null | undefined
    vendorName?: string | null
    jobUrl: string
  }
): Promise<void> {
  try {
    const to = (input.vendorEmail ?? '').trim()
    if (!to) return
    const { subject, html, text } = vendorJobLinkEmail({
      ...toTicketRef(input),
      vendorName: input.vendorName ?? null,
      jobUrl: input.jobUrl,
    })
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    console.error('[email] notifyVendorJobLink failed for ticket', input.ticketId, e)
  }
}

/** Confirmation to the tenant a ticket was filed on behalf of. */
export async function notifyTicketCreated(
  serviceClient: SupabaseClient,
  input: TicketContext & {
    reporterUserId: string | null | undefined
  }
): Promise<void> {
  try {
    const to = await resolveUserEmail(serviceClient, input.reporterUserId)
    if (!to) return
    const { subject, html, text } = ticketCreatedEmail(toTicketRef(input))
    await sendEmail({ to, subject, html, text })
  } catch (e) {
    console.error('[email] notifyTicketCreated failed for ticket', input.ticketId, e)
  }
}
