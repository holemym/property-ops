import type { Tenancy } from '@/types/domain'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'

// Pure, DB-free helpers for the rent roll + lease-expiration alerts. Everything here is
// deterministic and unit-testable: no `Date.now()` inside (the caller supplies `asOf`),
// no I/O. ISO calendar dates `YYYY-MM-DD` are compared lexicographically for coverage
// (valid because that format sorts chronologically as plain strings) and parsed as UTC
// midnight only when we need arithmetic (days-left), consistent with timeline.ts —
// avoiding timezone drift.

export type RentRollRow = {
  unitId: string
  label: string
  propertyName: string
  status: 'OCCUPIED' | 'VACANT'
  tenantName?: string
  rent?: number
  leaseStart?: string
  leaseEnd?: string | null
}

export type ExpiringLease = {
  unitId: string
  tenantName: string
  leaseEnd: string
  daysLeft: number
}

// One UTC day in milliseconds — the unit for days-left arithmetic.
const MS_PER_DAY = 86_400_000

// Parse an ISO 'YYYY-MM-DD' as UTC midnight. Returns NaN for null/malformed input so
// callers can guard. Mirrors the UTC discipline in timeline.ts / defaultWindow.
function parseUtc(iso: string | null | undefined): number {
  if (!iso) return NaN
  return Date.parse(`${iso}T00:00:00Z`)
}

// The as-of ISO date (UTC calendar day) for lexicographic coverage comparisons.
function asOfIso(asOf: Date): string {
  return asOf.toISOString().slice(0, 10)
}

/**
 * Build the rent roll as-of `asOf`: one row per unit. A unit is OCCUPIED when a tenancy
 * covers it — start_date <= asOf and (end_date null OR end_date >= asOf) — and we carry
 * that tenancy's tenant, rent, and dates. Where several tenancies cover the same point,
 * the earliest-starting one wins (ties broken by id), matching the timeline's tie-break.
 * Otherwise the unit is VACANT. Rows are sorted by property name then unit label.
 */
export function rentRoll(
  units: Unit[],
  tenancies: Tenancy[],
  properties: Property[],
  asOf: Date
): RentRollRow[] {
  const today = asOfIso(asOf)
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))

  // Pre-sort tenancies once: earliest start wins, then id. The first covering match per
  // unit is then the deterministic winner.
  const sorted = [...tenancies].sort((a, b) => {
    if (a.start_date !== b.start_date) return a.start_date < b.start_date ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const rows: RentRollRow[] = units.map((unit) => {
    const propName = propertyName.get(unit.property_id) ?? 'Unknown property'
    const covering = sorted.find(
      (t) =>
        t.unit_id === unit.id &&
        t.start_date <= today &&
        (t.end_date === null || t.end_date >= today)
    )
    if (covering) {
      return {
        unitId: unit.id,
        label: unit.label,
        propertyName: propName,
        status: 'OCCUPIED',
        tenantName: covering.tenant_name,
        rent: covering.rent_amount ?? undefined,
        leaseStart: covering.start_date,
        leaseEnd: covering.end_date,
      }
    }
    return {
      unitId: unit.id,
      label: unit.label,
      propertyName: propName,
      status: 'VACANT',
    }
  })

  return rows.sort((a, b) => {
    if (a.propertyName !== b.propertyName) return a.propertyName.localeCompare(b.propertyName)
    return a.label.localeCompare(b.label)
  })
}

/**
 * Leases whose end_date falls within [asOf, asOf + withinDays] — i.e. expiring soon.
 * Open-ended tenancies (end_date null) never expire and are skipped, as are leases that
 * already ended before `asOf`. `daysLeft` is whole UTC days from asOf to end_date (0 when
 * it ends today). Sorted soonest-first, then by unit for stable ordering.
 */
export function expiringLeases(
  tenancies: Tenancy[],
  asOf: Date,
  withinDays = 90
): ExpiringLease[] {
  const asOfMs = Date.parse(`${asOfIso(asOf)}T00:00:00Z`)
  const horizon = asOfMs + withinDays * MS_PER_DAY

  const out: ExpiringLease[] = []
  for (const t of tenancies) {
    if (!t.end_date) continue
    const endMs = parseUtc(t.end_date)
    if (Number.isNaN(endMs)) continue
    if (endMs < asOfMs || endMs > horizon) continue
    out.push({
      unitId: t.unit_id,
      tenantName: t.tenant_name,
      leaseEnd: t.end_date,
      daysLeft: Math.round((endMs - asOfMs) / MS_PER_DAY),
    })
  }

  return out.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft
    return a.unitId.localeCompare(b.unitId)
  })
}

/** Total monthly rent — Σ rent of OCCUPIED rows. Null/undefined rents contribute 0;
 * never returns NaN. */
export function totalMonthlyRent(rows: RentRollRow[]): number {
  return rows.reduce((sum, row) => {
    if (row.status !== 'OCCUPIED') return sum
    const rent = row.rent
    return sum + (typeof rent === 'number' && Number.isFinite(rent) ? rent : 0)
  }, 0)
}
