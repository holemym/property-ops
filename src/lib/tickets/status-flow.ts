import type { TicketStatus } from '@/types/domain'

/**
 * Legal ticket status transitions (ARCHITECTURE §7).
 *
 * Maps each status to the set of statuses it may legally advance to.
 *
 * Default flow:
 *   NEW → TRIAGE → ASSIGNED → SCHEDULED → IN_PROGRESS → RESOLVED → CLOSED
 *
 * Design decisions:
 * - TRIAGE → SCHEDULED is allowed: scheduling a visit already implies an
 *   assignment context, so a triaged ticket can be scheduled directly without
 *   first passing through ASSIGNED.
 * - WAITING_FOR_INFO is an interrupt state reachable from any active working
 *   state (TRIAGE, ASSIGNED, SCHEDULED, IN_PROGRESS) and can exit back to any
 *   of those (or be cancelled) once the missing info arrives.
 * - RESOLVED → IN_PROGRESS is the reopen path for when a fix did not hold.
 * - CLOSED and CANCELLED are terminal. ARCHITECTURE notes closed tickets should
 *   only be reopened by owner/operator with explicit reopen logic; that reopen
 *   feature is out of MVP scope (Phase 4), so CLOSED has no successors here.
 */
export const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['TRIAGE', 'CANCELLED'],
  TRIAGE: ['ASSIGNED', 'SCHEDULED', 'WAITING_FOR_INFO', 'CANCELLED'],
  WAITING_FOR_INFO: ['TRIAGE', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['SCHEDULED', 'IN_PROGRESS', 'WAITING_FOR_INFO', 'CANCELLED'],
  SCHEDULED: ['IN_PROGRESS', 'WAITING_FOR_INFO', 'ASSIGNED', 'CANCELLED'],
  IN_PROGRESS: ['RESOLVED', 'WAITING_FOR_INFO', 'CANCELLED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
  CANCELLED: [],
}

/** Returns true if `from → to` is a legal ticket status transition. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Asserts that `from → to` is legal, throwing otherwise.
 *
 * P3.4's updateStatus calls this before persisting. A DB-level trigger enforcing
 * the same rules is documented as a Phase-4 hardening step.
 */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal ticket status transition: ${from} → ${to}`)
  }
}

/**
 * Returns the legal next statuses from `from` (empty for terminal states).
 *
 * P3.6's detail page uses this to render only legal transition buttons.
 */
export function nextStatuses(from: TicketStatus): TicketStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? []
}
