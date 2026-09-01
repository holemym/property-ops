import type { Tenancy } from '@/types/domain'

// App-level double-booking guard for a unit's tenancies (pure and unit-testable, like
// the timeline builder next door). Spans are CLOSED intervals [start_date, end_date] —
// the end date is the last covered day, matching the unit hub's coversToday check — and
// a null end_date is open-ended ([start_date, ∞)). Two spans conflict when they share
// at least one calendar day, so a clean handover needs the next tenancy to start the
// day AFTER the previous one ends. ISO `YYYY-MM-DD` strings compare chronologically as
// plain strings, so no Date objects are constructed (no timezone drift).
//
// This complements — not replaces — the DB EXCLUDE constraint that ships separately:
// the DB is the un-bypassable backstop for concurrent writers; this layer exists to
// give the form a readable error naming the conflicting tenant and dates.

/**
 * The first tenancy in `tenancies` whose span intersects [startDate, endDate], or null
 * when the candidate span is clear. `excludeId` skips one row — the edit path passes
 * the edited tenancy's own id so a row never conflicts with itself. Callers passing a
 * start_date-ordered list (listTenanciesForUnit's order) get the earliest-starting
 * conflict back, which keeps the error message deterministic.
 */
export function findOverlappingTenancy(
  tenancies: Tenancy[],
  startDate: string,
  endDate: string | null,
  excludeId?: string
): Tenancy | null {
  for (const t of tenancies) {
    if (excludeId !== undefined && t.id === excludeId) continue
    // Closed-interval intersection: each span starts no later than the other ends
    // (an infinite end — null — never bounds the other side).
    const startsBeforeCandidateEnds = endDate === null || t.start_date <= endDate
    const candidateStartsBeforeEnds = t.end_date === null || startDate <= t.end_date
    if (startsBeforeCandidateEnds && candidateStartsBeforeEnds) return t
  }
  return null
}
