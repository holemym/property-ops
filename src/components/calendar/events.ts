// The shape of a single calendar event and its visual kind. Built server-side by the
// page from tickets / tenancies / documents, then bucketed by day (YYYY-MM-DD) for the
// grid. Kept pure and DB-free so it stays trivially testable.

export type CalendarEventKind = 'ticket' | 'move-in' | 'move-out' | 'doc-expiry'

export type CalendarEvent = {
  /** The day this event lands on, YYYY-MM-DD (matches a grid cell's `iso`). */
  date: string
  kind: CalendarEventKind
  label: string
  /** Optional short suffix shown muted after the label (e.g. a priority or type). */
  meta?: string
  /** Ticket events link to the ticket detail; other kinds are non-clickable chips. */
  href?: string
}

// Per-kind chip styling (tinted bg + readable text, dark-mode safe) mirroring the badge
// tones used elsewhere. Ordered so tickets read as informational (blue), move-ins as
// positive (green), move-outs as caution (amber), expiries as attention (red).
export const KIND_STYLES: Record<CalendarEventKind, { chip: string; dot: string; label: string }> = {
  ticket: {
    chip: 'bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:hover:bg-blue-500/30',
    dot: 'bg-blue-500',
    label: 'Scheduled ticket',
  },
  'move-in': {
    chip: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300',
    dot: 'bg-green-500',
    label: 'Lease move-in',
  },
  'move-out': {
    chip: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
    dot: 'bg-amber-500',
    label: 'Lease move-out',
  },
  'doc-expiry': {
    chip: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
    dot: 'bg-red-500',
    label: 'Document expiry',
  },
}

/**
 * Bucket a flat event list into a Map keyed by day (YYYY-MM-DD). Within each day, events
 * are ordered by kind (tickets first, then move-ins, move-outs, expiries) then by label,
 * so a day's chips render in a stable, sensible order.
 */
export function bucketByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const order: Record<CalendarEventKind, number> = {
    ticket: 0,
    'move-in': 1,
    'move-out': 2,
    'doc-expiry': 3,
  }
  const byDay = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const list = byDay.get(ev.date)
    if (list) list.push(ev)
    else byDay.set(ev.date, [ev])
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => order[a.kind] - order[b.kind] || a.label.localeCompare(b.label))
  }
  return byDay
}
