import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActorType, TicketEventType } from '@/types/domain'

export type TicketEvent = {
  id: string
  workspace_id: string
  ticket_id: string
  actor_user_id: string | null
  actor_type: ActorType
  event_type: TicketEventType
  old_value_json: unknown | null
  new_value_json: unknown | null
  metadata_json: unknown | null
  created_at: string
}

export type AppendTicketEventInput = {
  workspaceId: string
  ticketId: string
  eventType: TicketEventType
  actorUserId?: string | null
  actorType?: ActorType
  oldValueJson?: unknown
  newValueJson?: unknown
  metadataJson?: unknown
}

/**
 * Append an event to the audit log (deferred obligation P3.2).
 *
 * MUST be called with a SERVICE-ROLE client. The 0012 migration REVOKEs EXECUTE on
 * public.log_ticket_event from `authenticated` and grants it only to `service_role`,
 * so the RLS-bound authenticated client can NOT call this RPC (it would fail with
 * "permission denied for function"). The data layer's ticket WRITES stay pure (they
 * use the authenticated, RLS-bound client); event logging is a SEPARATE service-role
 * call the P3.6 action makes AFTER the ticket mutation succeeds. This keeps the
 * service-role client out of the ordinary write path while still recording
 * tenant-driven events through the controlled definer funnel.
 *
 * Note the p_* param-name mapping the SQL function declares.
 */
export async function appendTicketEvent(
  serviceClient: SupabaseClient,
  input: AppendTicketEventInput
): Promise<void> {
  const { error } = await serviceClient.rpc('log_ticket_event', {
    p_workspace_id: input.workspaceId,
    p_ticket_id: input.ticketId,
    p_event_type: input.eventType,
    p_actor_user_id: input.actorUserId ?? null,
    p_actor_type: input.actorType ?? 'USER',
    p_old_value_json: input.oldValueJson ?? null,
    p_new_value_json: input.newValueJson ?? null,
    p_metadata_json: input.metadataJson ?? null,
  })
  if (error) throw error
}

/**
 * Chronological audit timeline for a ticket. RLS (0012) scopes visibility: managers +
 * accountant see the workspace event log; tenants get ZERO rows from the raw event
 * feed (per-ticket event history for a tenant, if ever surfaced, is a filtered app
 * read, not this). Ordered oldest-first. Double-scoped.
 */
export async function listTicketEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  ticketId: string
): Promise<TicketEvent[]> {
  const { data, error } = await supabase
    .from('ticket_events')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as TicketEvent[]
}
