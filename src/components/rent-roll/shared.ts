// Shared, dependency-free formatting for the rent-roll surface. Money is EUR, whole-euro
// (no cents), matching the finance/insights convention.
//
// `formatDate` (short calendar date, UTC-pinned) comes from the shared formatter and is
// re-exported so lease dates read the same as everywhere else in the app.
import { formatDate } from '@/lib/format-date'
export { formatDate }

// Whole-euro EUR — re-exported from THE shared formatter (src/lib/format-money).
export { formatMoney } from '@/lib/format-money'


// Human days-left label for an expiring lease pill: 'today' / 'in 1 day' / 'in N days'.
export function formatDaysLeft(daysLeft: number): string {
  if (daysLeft <= 0) return 'today'
  if (daysLeft === 1) return 'in 1 day'
  return `in ${daysLeft} days`
}
