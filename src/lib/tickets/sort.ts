import type { Ticket } from '@/lib/data/tickets'
import type { TicketPriority, TicketStatus } from '@/types/domain'

// Client-facing table sort for the ticket list. Kept pure + DB-free so it's testable and
// so the page can sort the already-fetched list without a second query (MVP scale). The
// URL carries ?sort=<column>&dir=asc|desc; ascending is the "natural" low→high order and
// `desc` reverses it, so the sensible defaults fall out: created desc = newest first,
// priority desc = most urgent first, status desc = latest lifecycle stage first.

export const SORT_COLUMNS = ['created', 'title', 'priority', 'status'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDir = 'asc' | 'desc'

export function isSortColumn(v: unknown): v is SortColumn {
  return typeof v === 'string' && (SORT_COLUMNS as readonly string[]).includes(v)
}

// Ascending rank: LOW → URGENT (so desc surfaces URGENT first).
const PRIORITY_RANK: Record<TicketPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, URGENT: 3 }

// Ascending rank following the lifecycle order.
const STATUS_RANK: Record<TicketStatus, number> = {
  NEW: 0, TRIAGE: 1, WAITING_FOR_INFO: 2, ASSIGNED: 3, SCHEDULED: 4,
  IN_PROGRESS: 5, RESOLVED: 6, CLOSED: 7, CANCELLED: 8,
}

function ascendingCompare(a: Ticket, b: Ticket, sort: SortColumn): number {
  switch (sort) {
    case 'title':
      return a.title.localeCompare(b.title)
    case 'priority':
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status]
    case 'created':
    default:
      return a.created_at.localeCompare(b.created_at)
  }
}

/** Return a new, sorted copy of the tickets. Stable input order is preserved on ties. */
export function sortTickets(tickets: Ticket[], sort: SortColumn, dir: SortDir): Ticket[] {
  const sorted = [...tickets].sort((a, b) => ascendingCompare(a, b, sort))
  return dir === 'desc' ? sorted.reverse() : sorted
}
