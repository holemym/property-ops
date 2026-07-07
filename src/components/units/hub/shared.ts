import type { DocumentType, TicketStatus } from '@/types/domain'

// Self-contained formatting helpers for the unit hub. Money is EUR, whole-euro (no
// cents), matching the finance / rent-roll / insights convention. Dates are UTC-parsed
// from `YYYY-MM-DD` so nothing drifts across timezones (mirrors the timeline builder,
// which compares the same ISO strings lexically).

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

const dateFmt = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return iso
  return dateFmt.format(new Date(t))
}

// A tenancy span 'start – end' (or 'start – open-ended' when end is null).
export function formatSpan(start: string, end: string | null): string {
  return `${formatDate(start)} – ${end ? formatDate(end) : 'open-ended'}`
}

// UPPER_SNAKE enum → 'Title case' label ('APPLIANCE_REPAIR' → 'Appliance repair').
export function humanizeEnum(value: string): string {
  const spaced = value.replace(/_/g, ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// Terminal ticket states — a ticket in one of these is "done" / no longer open.
export const TERMINAL_TICKET_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED']

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
