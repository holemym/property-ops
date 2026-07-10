import type { SupabaseClient } from '@supabase/supabase-js'
import type { TicketCategory, TicketPriority } from '@/types/domain'
import { classifyTicket, suggestTriageHeuristic } from './triage'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import { createTicketComment } from '@/lib/data/ticket-comments'
import { isDemoWorkspace } from '@/lib/demo'

// ---------------------------------------------------------------------------
// runAutoTriage — the server-side write side of triage. Called best-effort from the
// ticket-create actions AFTER the row exists, with a SERVICE-ROLE client (the only
// principal allowed to call log_ticket_event and to post an INTERNAL note attributed to
// a non-manager author). It NEVER throws — a triage failure logs and returns, exactly
// like the TICKET_CREATED audit event, so the created ticket is never lost to a triage
// hiccup. Disconnected-safe: with no ANTHROPIC_API_KEY, classifyTicket() runs the
// offline heuristic (zero cost, no API call).
// ---------------------------------------------------------------------------

export type AutoTriageInput = {
  workspaceId: string
  ticketId: string
  createdByUserId: string
  title: string
  description: string
  filedCategory: TicketCategory
  filedPriority: TicketPriority
}

// PLUMBING -> "Plumbing", URGENT -> "Urgent". Enum labels are single words here.
function label(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase()
}

export async function runAutoTriage(
  serviceClient: SupabaseClient,
  input: AutoTriageInput
): Promise<void> {
  try {
    // D4 in-demo gate: force the offline heuristic even if ANTHROPIC_API_KEY is set, so a
    // public demo visitor filing tickets can never burn real API tokens. The heuristic is
    // already the zero-cost, key-free path (classifyTicket would also fall back to it if
    // no key were configured) — this just pins to it unconditionally for the demo
    // workspace, bypassing classifyTicket's isAiTriageEnabled() check entirely.
    const suggestion = isDemoWorkspace(input.workspaceId)
      ? suggestTriageHeuristic({ title: input.title, description: input.description })
      : await classifyTicket({ title: input.title, description: input.description })
    const isAi = suggestion.source === 'ai'

    // Audit event: an AI/AUTOMATION actor (no user) generated a classification. The
    // suggestion goes in new_value_json; how it compares to the filing goes in metadata.
    await appendTicketEvent(serviceClient, {
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      eventType: 'AI_CLASSIFICATION_GENERATED',
      actorUserId: null,
      actorType: isAi ? 'AI' : 'AUTOMATION',
      newValueJson: { category: suggestion.category, priority: suggestion.priority },
      metadataJson: {
        source: suggestion.source,
        confidence: suggestion.confidence,
        note: suggestion.note,
        filedCategory: input.filedCategory,
        filedPriority: input.filedPriority,
      },
    })

    // Human-visible INTERNAL note in the comment thread. Triage SUGGESTS; it never
    // overwrites what the filer chose — a manager reads this and decides. Attributed to
    // the creating user (MVP convention for AI_NOTE/SYSTEM_NOTE, per 0012).
    const agrees =
      suggestion.category === input.filedCategory &&
      suggestion.priority === input.filedPriority
    const pct = `${Math.round(suggestion.confidence * 100)}%`
    const header = isAi ? 'AI triage' : 'Auto-triage'
    const body = agrees
      ? `${header}: agrees with the filing — ${label(suggestion.category)} / ${label(suggestion.priority)} (confidence ${pct}). ${suggestion.note}`
      : `${header}: suggests ${label(suggestion.category)} / ${label(suggestion.priority)} (confidence ${pct}), filed as ${label(input.filedCategory)} / ${label(input.filedPriority)}. ${suggestion.note}`

    await createTicketComment(serviceClient, {
      workspaceId: input.workspaceId,
      ticketId: input.ticketId,
      authorUserId: input.createdByUserId,
      body,
      visibility: 'INTERNAL',
      type: isAi ? 'AI_NOTE' : 'SYSTEM_NOTE',
    })
  } catch (e) {
    console.error('[triage] runAutoTriage failed for ticket', input.ticketId, e)
  }
}
