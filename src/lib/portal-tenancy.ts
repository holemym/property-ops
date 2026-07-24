import type { Tenancy } from '@/types/domain'

// Pure, DB-free "which lease is my CURRENT home" picker for the tenant portal's
// My Home surface (Phase 1B). listMyTenancies (src/lib/data/tenancies.ts) returns
// EVERY tenancy RLS lets the caller see — which, thanks to tenancies_select_own_
// tenant (migration 0030), is exactly the caller's own leases, current AND past,
// possibly across several units. Picking the one to headline is a pure decision
// with no I/O, so it lives here (mirrors the portal-status.ts precedent: portal-
// specific pure logic gets its own small, DB-free, unit-tested module) rather than
// inside the data-layer fetcher.
//
// `todayIso` is CALLER-SUPPLIED (never `new Date()`/`Date.now()` inside) — the
// same no-hidden-clock discipline as isInvoiceOverdue (src/lib/invoices/compute.ts)
// and the occupancy/rent-roll pure modules, so this is safe to call from a Server
// Component without any SSR/hydration clock-skew risk.

/**
 * Pick the tenancy to show as "your home": the CURRENT lease (end_date is null —
 * open-ended/month-to-month — OR end_date >= todayIso), preferring the
 * most-recently-STARTED one when more than one currently covers the caller (e.g. a
 * mid-move overlap). If none is current (every lease has already ended), fall back
 * to the most-recently-ENDED past lease, so a former resident still sees their last
 * home rather than a blank state. Returns null only when `tenancies` is empty.
 */
export function pickCurrentTenancy(tenancies: Tenancy[], todayIso: string): Tenancy | null {
  if (tenancies.length === 0) return null

  const current = tenancies.filter((t) => t.end_date === null || t.end_date >= todayIso)
  if (current.length > 0) {
    return mostRecentByStartDate(current)
  }

  // Every tenancy has ended — fall back to the most recently ended one, i.e. the
  // latest end_date (all non-null here, since a null end_date would have matched
  // the `current` filter above).
  return [...tenancies].sort((a, b) => {
    if (a.end_date === b.end_date) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    return (a.end_date as string) < (b.end_date as string) ? 1 : -1
  })[0]
}

function mostRecentByStartDate(tenancies: Tenancy[]): Tenancy {
  return [...tenancies].sort((a, b) => {
    if (a.start_date === b.start_date) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    return a.start_date < b.start_date ? 1 : -1
  })[0]
}
