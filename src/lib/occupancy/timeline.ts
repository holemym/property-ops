import type { Tenancy, UnitStatus } from '@/types/domain'

// A pure, DB-free segmentation of a single unit's occupancy across a date window.
// Everything here is deterministic and unit-testable: no `Date.now()` inside
// buildUnitTimeline (the caller supplies the window), no I/O. Dates are ISO calendar
// strings `YYYY-MM-DD` compared lexicographically — valid because that format sorts
// chronologically as plain strings, so we never construct Date objects (avoiding
// timezone drift). All windows/segments are HALF-OPEN intervals: [from, to).

export type OccupancyState = 'OCCUPIED' | 'VACANT' | 'MAINTENANCE' | 'BLOCKED'

export type OccupancySegment = {
  from: string
  to: string
  state: OccupancyState
  tenantName?: string
}

// A half-open date window [from, to): `from` inclusive, `to` exclusive. ISO dates.
export type DateWindow = { from: string; to: string }

/**
 * Default rolling window for the timeline: 6 whole months starting at the FIRST of the
 * current month. e.g. now = 2026-07-07 -> [2026-07-01, 2027-01-01). Computed in UTC so
 * it is deterministic regardless of the server's local timezone.
 */
export function defaultWindow(now: Date): DateWindow {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0-based
  const from = isoDate(year, month, 1)
  // +6 months; Date handles the year rollover (month 12 -> next January).
  const to = isoDate(year, month + 6, 1)
  return { from, to }
}

function isoDate(year: number, monthZeroBased: number, day: number): string {
  // Date.UTC normalizes out-of-range months (e.g. month 13 -> next year Feb).
  return new Date(Date.UTC(year, monthZeroBased, day)).toISOString().slice(0, 10)
}

/**
 * Partition `window` into contiguous, chronologically-ordered segments for ONE unit.
 *
 * Rules (deterministic, v1):
 * 1. If `unitStatus` is 'MAINTENANCE' or 'BLOCKED', the unit is out of service NOW, and
 *    that current ops flag overrides the tenancy view: a SINGLE segment spans the whole
 *    window with that state. Documented v1 simplification (we don't yet time-range
 *    out-of-service periods; unit.status is point-in-time).
 * 2. Otherwise it is tenancy-driven. Each tenancy covers [start_date, end_date) — or
 *    [start_date, +infinity) when end_date is null (open-ended). Sub-intervals of the
 *    window covered by any tenancy are 'OCCUPIED' (carrying that tenancy's tenant_name);
 *    gaps are 'VACANT'. Tenancy ranges are clipped to the window; tenancies fully
 *    outside the window contribute nothing. Where multiple tenancies overlap a point,
 *    OCCUPIED wins and we use the EARLIEST-STARTING covering tenancy's name (ties broken
 *    by tenancy id for determinism).
 *
 * Output invariants: segments are contiguous, in chronological order, and together cover
 * exactly [window.from, window.to). Adjacent same-state (and, for OCCUPIED, same-name)
 * segments are merged. An empty/inverted window ([from >= to)) yields [].
 */
export function buildUnitTimeline(
  unitStatus: UnitStatus,
  tenancies: Tenancy[],
  window: DateWindow
): OccupancySegment[] {
  if (window.from >= window.to) return []

  if (unitStatus === 'MAINTENANCE' || unitStatus === 'BLOCKED') {
    return [{ from: window.from, to: window.to, state: unitStatus }]
  }

  // Collect the window's internal boundary points: every tenancy start/end that falls
  // strictly inside the window becomes a cut point. Sorting the unique set gives the
  // minimal set of sub-intervals over which occupancy is constant.
  const cuts = new Set<string>([window.from, window.to])
  for (const t of tenancies) {
    if (t.start_date > window.from && t.start_date < window.to) cuts.add(t.start_date)
    if (t.end_date && t.end_date > window.from && t.end_date < window.to) cuts.add(t.end_date)
  }
  const points = [...cuts].sort()

  // Deterministic tie-break: earliest start_date wins, then id. Pre-sorting the tenancy
  // list once means the first match found per sub-interval is the winner.
  const sorted = [...tenancies].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const raw: OccupancySegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    // A tenancy covers this sub-interval iff start_date <= from and (end_date is null or
    // end_date >= to). Because `to` is a cut point, no tenancy edge falls strictly inside
    // [from, to), so testing the sub-interval's endpoints is sufficient.
    const covering = sorted.find(
      (t) => t.start_date <= from && (t.end_date === null || t.end_date >= to)
    )
    if (covering) {
      raw.push({ from, to, state: 'OCCUPIED', tenantName: covering.tenant_name })
    } else {
      raw.push({ from, to, state: 'VACANT' })
    }
  }

  // Merge adjacent segments of the same state (and same tenantName for OCCUPIED).
  const merged: OccupancySegment[] = []
  for (const seg of raw) {
    const prev = merged[merged.length - 1]
    if (prev && prev.state === seg.state && prev.tenantName === seg.tenantName) {
      prev.to = seg.to
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}
