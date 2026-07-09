// Single source of truth for human *calendar-date* formatting across the app. The locale is
// pinned to 'en-IE' — an unambiguous "9 Jul 2026" day-month-year that fits the app's
// European/EUR context — and the time zone to UTC. Together these make a date render
// identically on the server and the client (a bare `toLocaleDateString()` uses the runtime's
// locale + zone, which can differ between SSR and hydration).
//
// UTC pinning matters for the date-only values these helpers format (lease start/end, invoice
// issue/due dates, document expiry, finance periods): those are stored as 'YYYY-MM-DD', which
// `Date.parse` reads as UTC midnight, so formatting in UTC shows the stored calendar day in
// every viewer's zone instead of drifting to the day before in negative offsets.
//
// For instants (created_at/paid_at timestamps) prefer a time-aware format at the call site.

const shortFmt = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const longFmt = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// Null/undefined → em dash; unparseable → the raw string, so a bad row still renders something.
function apply(fmt: Intl.DateTimeFormat, iso: string | null | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return fmt.format(new Date(t))
}

// "9 Jul 2026" — the default for lists, tables, and detail rows.
export function formatDate(iso: string | null | undefined): string {
  return apply(shortFmt, iso)
}

// "9 July 2026" — for printed/emailed documents where the long month reads better.
export function formatDateLong(iso: string | null | undefined): string {
  return apply(longFmt, iso)
}
