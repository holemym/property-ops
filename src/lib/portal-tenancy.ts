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

// The lease-state badge shown on My Home, alongside the tenancy card. Reuses the SAME
// 90-day "expiring soon" horizon already established for lease alerts elsewhere
// (src/lib/occupancy/rent-roll.ts's expiringLeases default, and documents/page.tsx's
// EXPIRY_WINDOW_DAYS) rather than inventing a new threshold, per the house convention
// of one number for "coming up soon" across the app.
const LEASE_ENDING_SOON_WINDOW_DAYS = 90

export type LeaseState = 'current' | 'ending_soon' | 'ended'

// One UTC day, matching rent-roll.ts's MS_PER_DAY discipline.
const MS_PER_DAY = 86_400_000

function addDaysIso(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Classify a tenancy's lease state as of `todayIso`, for the My Home badge (Current /
 * Ending soon / Ended). Pure + DB-free, same no-hidden-clock discipline as
 * pickCurrentTenancy above — `todayIso` is always caller-supplied.
 *
 * An open-ended (month-to-month) lease is always 'current' — it has no end date to
 * count down to. A lease that already ended (end_date < todayIso) is 'ended' — this can
 * happen when pickCurrentTenancy falls back to a past lease because none is current. A
 * lease ending within the window (todayIso <= end_date <= todayIso + windowDays) is
 * 'ending_soon'; anything further out is 'current'.
 */
export function leaseState(
  tenancy: Tenancy,
  todayIso: string,
  windowDays: number = LEASE_ENDING_SOON_WINDOW_DAYS
): LeaseState {
  if (tenancy.end_date === null) return 'current'
  if (tenancy.end_date < todayIso) return 'ended'
  const horizon = addDaysIso(todayIso, windowDays)
  return tenancy.end_date <= horizon ? 'ending_soon' : 'current'
}
