'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { ticketCreateSchema } from '@/lib/validation/ticket'
import { createTicket } from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'

// Service-role client: mirrors src/app/(app)/settings/users/actions.ts. Required for
// event logging because migration 0012 REVOKEs EXECUTE on log_ticket_event from
// `authenticated` and grants it only to `service_role` — the RLS-bound authenticated
// client would fail with "permission denied for function". SUPABASE_SERVICE_ROLE_KEY is
// server-only (never NEXT_PUBLIC) and only ever read inside this 'use server' file, so
// it is never shipped to the client bundle.
function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

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
    await appendTicketEvent(serviceClient(), {
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
