// Shared, dependency-free formatting for the rent-roll surface. Money is EUR, whole-euro
// (no cents), matching the finance/insights convention.
//
// `formatDate` (short calendar date, UTC-pinned) comes from the shared formatter and is
// re-exported so lease dates read the same as everywhere else in the app.
import { formatDate } from '@/lib/format-date'
export { formatDate }

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

// A lease span 'start – end' (or 'start – open-ended' when end is null).
export function formatLeaseSpan(start: string | undefined, end: string | null | undefined): string {
  if (!start) return '—'
  return `${formatDate(start)} – ${end ? formatDate(end) : 'open-ended'}`
}

// Human days-left label for an expiring lease pill: 'today' / 'in 1 day' / 'in N days'.
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft <= 0) return 'today'
  if (daysLeft === 1) return 'in 1 day'
  return `in ${daysLeft} days`
}
