// Pure, DB-free month-grid math for the calendar view. Everything here is deterministic
// and side-effect-free: no Date.now() inside the builders (the page supplies the anchor).
//
// Dates are handled as ISO calendar strings `YYYY-MM-DD` and compared lexicographically —
// valid because that format sorts chronologically as plain strings. Where we DO construct
// Date objects (to walk the 6-week grid), we build and read them in UTC via Date.UTC /
// getUTC* so there is no timezone drift, matching the occupancy timeline convention.

// The week starts on Monday. Sunday=0 in JS getUTCDay(); remap so Monday=0 … Sunday=6.
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** A single day cell in the grid. `iso` is YYYY-MM-DD (UTC). */
export type CalendarDay = {
  iso: string
  day: number
  /** True when the cell belongs to the anchor month (vs a leading/trailing spill day). */
  inMonth: boolean
}

// Monday-based weekday index (0=Mon … 6=Sun) for a JS UTC day-of-week (0=Sun … 6=Sat).
function mondayIndex(utcDay: number): number {
  return (utcDay + 6) % 7
}

/** Pad a number to a 2-digit string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * Parse a `?month=YYYY-MM` param into a { year, month0 } anchor (month0 = 0-based month).
 * Returns null when the value is missing or malformed — the page then falls back to the
 * current month. Month must be 01–12; anything else is rejected.
 */
export function parseMonthParam(raw: string | undefined): { year: number; month0: number } | null {
  if (!raw) return null
  const m = /^(\d{4})-(\d{2})$/.exec(raw)
  if (!m) return null
  const year = Number(m[1])
  const month1 = Number(m[2])
  if (month1 < 1 || month1 > 12) return null
  return { year, month0: month1 - 1 }
}

/** The current month anchor, computed in UTC from `now`. */
export function currentMonth(now: Date): { year: number; month0: number } {
  return { year: now.getUTCFullYear(), month0: now.getUTCMonth() }
}

/** Format an anchor back to the `YYYY-MM` param form. Handles month rollover. */
export function toMonthParam(year: number, month0: number): string {
  // Normalize out-of-range months (e.g. -1 -> prev Dec, 12 -> next Jan) via Date.UTC.
  const d = new Date(Date.UTC(year, month0, 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

/** Human month label, e.g. "July 2026". */
export function monthLabel(year: number, month0: number): string {
  const d = new Date(Date.UTC(year, month0, 1))
  return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** The `YYYY-MM` param of the month before the anchor. */
export function prevMonthParam(year: number, month0: number): string {
  return toMonthParam(year, month0 - 1)
}

/** The `YYYY-MM` param of the month after the anchor. */
export function nextMonthParam(year: number, month0: number): string {
  return toMonthParam(year, month0 + 1)
}

/**
 * Build the 6-week (42-cell) grid for a month: start at the first of the month, back up to
 * the Monday of that week, then walk 42 consecutive days. Six weeks always fully contains
 * any month (even a 31-day month starting on Sunday), so the grid never reflows.
 */
export function buildMonthGrid(year: number, month0: number): CalendarDay[] {
  const first = new Date(Date.UTC(year, month0, 1))
  // Back up to the week's Monday.
  const start = new Date(first)
  start.setUTCDate(first.getUTCDate() - mondayIndex(first.getUTCDay()))

  const days: CalendarDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    days.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month0 && d.getUTCFullYear() === year,
    })
  }
  return days
}

/**
 * The [from, to) ISO date bounds of the visible grid — the first cell (inclusive) and the
 * day AFTER the last cell (exclusive). Used to pre-filter events to the visible window.
 */
export function gridBounds(year: number, month0: number): { from: string; to: string } {
  const grid = buildMonthGrid(year, month0)
  const from = grid[0].iso
  const last = new Date(`${grid[41].iso}T00:00:00Z`)
  last.setUTCDate(last.getUTCDate() + 1)
  return { from, to: last.toISOString().slice(0, 10) }
}
