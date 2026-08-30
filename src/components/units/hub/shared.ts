import type { DocumentType } from '@/types/domain'

// Self-contained formatting helpers for the unit hub. Money is EUR, whole-euro (no
// cents), matching the finance / rent-roll / insights convention. `formatDate` (short
// calendar date, UTC-pinned so nothing drifts across timezones) comes from the shared
// formatter and is re-exported to keep every surface consistent.
import { formatDate } from '@/lib/format-date'
export { formatDate }

// Whole-euro EUR — re-exported from THE shared formatter (src/lib/format-money).
export { formatMoney } from '@/lib/format-money'

// A tenancy span 'start – end' (or 'start – open-ended' when end is null).
export function formatSpan(start: string, end: string | null): string {
  return `${formatDate(start)} – ${end ? formatDate(end) : 'open-ended'}`
}

// UPPER_SNAKE enum → 'Title case' label ('APPLIANCE_REPAIR' → 'Appliance repair').
export function humanizeEnum(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Today as an ISO calendar day (UTC), for tenancy "covers today" checks that compare
// against the same `YYYY-MM-DD` strings the timeline uses.
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// A tenancy's lifecycle relative to `today` (half-open [start, end)): current if it
// covers today, upcoming if it starts later, otherwise past.
export type TenancyPhase = 'current' | 'upcoming' | 'past'

export function tenancyPhase(
  start: string,
  end: string | null,
  today: string
): TenancyPhase {
  if (start > today) return 'upcoming'
  if (end !== null && end <= today) return 'past'
  return 'current'
}

// Days between `today` and an ISO expiry (UTC), or null if unparseable/absent. Negative
// when already expired.
export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((t - start) / 86_400_000)
}

// Document type labels, sentence case for the type badge.
export function documentTypeLabel(type: DocumentType): string {
  return humanizeEnum(type)
}
