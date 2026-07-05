'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { redirectWithError } from '@/lib/redirect-with-error'
import { ticketCreateSchema, ticketCommentSchema } from '@/lib/validation/ticket'
import { createTicket } from '@/lib/data/tickets'
import { createTicketComment } from '@/lib/data/ticket-comments'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'

// =============================================================================
// TENANT PORTAL server actions (P3.7).
//
// These are the TENANT analog of the operator ticket actions. The operator actions
// gate on the permission matrix (requirePermission('tickets:write')); tenants hold
// ZERO ticket-matrix permissions, so they gate on ROLE MEMBERSHIP (isTenantRole)
// instead. The REAL enforcement is RLS: tickets_insert_own pins created_by = auth.uid()
// and comments_insert_own_public pins visibility = PUBLIC + ownership; the app-layer
// isTenantRole guard is a defense-in-depth wrapper that gives a clean redirect instead
// of a raw RLS/permission error and keeps managers out of the tenant surface.
//
// The service-role client is used ONLY for best-effort event logging (never for reads
// or the primary write), mirroring the P3.6 discipline exactly.
// =============================================================================

export async function reportIssueAction(formData: FormData) {
  const user = await requireWorkspace()
  // Role-membership guard: only tenants/guests use this action. Managers have their own
  // operator createTicketAction. A non-tenant hitting this action is bounced with a
  // clean message rather than silently succeeding on a surface not meant for them.
  if (!isTenantRole(user.role)) {
    redirectWithError('/portal', 'Not available for your role.')
  }

  // Tenant-create parse. We DELIBERATELY do NOT read `priority` from the form — tenants
  // cannot set priority (they would all pick URGENT). We inject priority: 'NORMAL' so the
  // shared ticketCreateSchema (which requires a priority enum) validates. createTicket +
  // the DB BEFORE-INSERT trigger also force safe defaults (status NEW, no assignment) for
  // non-managers, so priority is the only "who set it" field and it is pinned to NORMAL
  // here regardless of anything the client sends.
  const parsed = ticketCreateSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    category: formData.get('category'),
    priority: 'NORMAL',
    propertyId: formData.get('propertyId'),
    // '' (no unit chosen) -> undefined so the optional/nullable uuid check passes.
    unitId: (formData.get('unitId') as string | null) || undefined,
  })
  if (!parsed.success) {
    redirectWithError('/portal/new', parsed.error.issues[0].message)
  }

  const { title, description, category, propertyId, unitId } = parsed.data
  const supabase = await createClient()

  // Confirm the chosen property is in this workspace (a tenant CAN list workspace
  // properties via properties_select_workspace, so the select is legitimate, but the
  // submitted id is still user-supplied — re-validate). Same guard as the operator create.
  const property = await getProperty(supabase, user.workspaceId, propertyId)
  if (!property) {
    redirectWithError('/portal/new', 'Selected property was not found.')
  }

  // If a unit was chosen it must exist in this workspace AND belong to the chosen
  // property — the flat unit select could otherwise pair a unit with the wrong property.
  if (unitId) {
    const unit = await getUnit(supabase, user.workspaceId, unitId)
    if (!unit || unit.property_id !== propertyId) {
      redirectWithError('/portal/new', 'Selected unit does not belong to the chosen property.')
    }
  }

  let ticketId: string
  try {
    const ticket = await createTicket(supabase, {
      workspaceId: user.workspaceId,
      propertyId,
      unitId: unitId ?? null,
      // created_by = the tenant, so RLS tickets_insert_own (created_by = auth.uid())
      // passes. status is forced NEW by createTicket + the DB trigger; priority NORMAL.
      createdByUserId: user.id,
      title,
      description,
      category,
      priority: 'NORMAL',
    })
    ticketId = ticket.id
  } catch (e) {
    // redirectWithError throws NEXT_REDIRECT, so ticketId is definitely assigned past here.
    redirectWithError('/portal/new', e instanceof Error ? e.message : 'Could not report issue.')
  }

  // Best-effort audit event via the SERVICE-ROLE client (the only principal allowed to
  // call log_ticket_event). Mirrors createTicketAction: a created ticket with a missing
  // audit event beats a 500 after the row already exists. Never fails the action.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId,
      eventType: 'TICKET_CREATED',
      actorUserId: user.id,
      actorType: 'USER',
      newValueJson: { status: 'NEW', title, category, priority: 'NORMAL' },
    })
  } catch (e) {
    console.error('Failed to log TICKET_CREATED event for tenant ticket', ticketId, e)
  }

  revalidatePath('/portal')
  redirect(`/portal/${ticketId}`)
}

export async function addPublicCommentAction(id: string, formData: FormData) {
  const user = await requireWorkspace()
  const detailPath = `/portal/${id}`
  if (!isTenantRole(user.role)) {
    redirectWithError('/portal', 'Not available for your role.')
  }

  // Only the body is read from the form. visibility is FORCED to 'PUBLIC' — the tenant
  // form has NO visibility field, and even if a crafted POST supplied one it is ignored
  // here; RLS comments_insert_own_public pins visibility = PUBLIC + ownership too. A
  // tenant can therefore NEVER post an INTERNAL comment.
  const parsed = ticketCommentSchema.safeParse({
    body: formData.get('body'),
    visibility: 'PUBLIC',
  })
  if (!parsed.success) {
    redirectWithError(detailPath, parsed.error.issues[0].message)
  }
  const { body } = parsed.data

  const supabase = await createClient()
  try {
    await createTicketComment(supabase, {
      workspaceId: user.workspaceId,
      ticketId: id,
      authorUserId: user.id,
      body,
      // Hardcoded PUBLIC (belt-and-suspenders with the RLS pin above).
      visibility: 'PUBLIC',
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
      metadataJson: { visibility: 'PUBLIC' },
    })
  } catch (e) {
    console.error('Failed to log COMMENT_ADDED event for tenant ticket', id, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}
