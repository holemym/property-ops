// Ticket-list sort spec. The URL carries ?sort=<column>&dir=asc|desc; the tickets page
// pushes this to the database (ORDER BY + range pagination) rather than sorting a
// full-table fetch in JS. `dir` "asc" is the natural low→high order and "desc" reverses.

export const SORT_COLUMNS = ['created', 'title', 'priority', 'status'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDir = 'asc' | 'desc'

export function isSortColumn(v: unknown): v is SortColumn {
  return typeof v === 'string' && (SORT_COLUMNS as readonly string[]).includes(v)
}

// Map a sort column to the DB column PostgREST orders on. `priority` and `status` are
// Postgres enum columns, and Postgres orders enums by their DECLARATION order — which for
// ticket_priority ('LOW','NORMAL','HIGH','URGENT') and ticket_status
// ('NEW',…,'CANCELLED') is exactly the intended low→high order. So `ascending: false`
// surfaces URGENT / the latest lifecycle stage first, matching the header defaults.
// (Verified against the enum definitions in migration 0011 / schema_bundle.sql.)
export const TICKET_DB_COLUMN: Record<SortColumn, string> = {
  created: 'created_at',
  title: 'title',
  priority: 'priority',
  status: 'status',
}
