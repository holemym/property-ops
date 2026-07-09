// Plain formatting helpers for the Insights dashboard — deliberately NOT in charts.tsx.
// charts.tsx is 'use client'; a function exported from a client module becomes a client
// reference, and Next.js throws ("Attempted to call X() from the server...") if a Server
// Component invokes it directly rather than only rendering/passing it to a Client
// Component. insights/page.tsx (a Server Component) calls these directly to build metric
// strings, so they must live in a server-safe module. charts.tsx imports them from here
// too, for its own client-side use.

const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

export function formatDays(value: number | null): string {
  if (value === null) return '—'
  const rounded = Math.round(value)
  return `${rounded.toLocaleString()} ${rounded === 1 ? 'day' : 'days'}`
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString()
}
