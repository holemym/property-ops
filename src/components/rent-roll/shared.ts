// Shared, dependency-free formatting for the rent-roll surface. Money is EUR, whole-euro
// (no cents), matching the finance/insights convention.
const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

// 'YYYY-MM-DD' → a short human date ('1 Jun 2026'), UTC so it doesn't drift across
// timezones. Falls back to the raw string if unparseable, and to an em-dash for null
// (open-ended lease).
const dateFmt = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(t)) return iso
  return dateFmt.format(new Date(t))
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
