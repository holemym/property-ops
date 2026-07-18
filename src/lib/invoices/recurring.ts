import type { Tenancy, InvoiceStatus } from '@/types/domain'
import { formatMonth } from '@/components/finance/shared'

// The pure planner for "Generate rent" (Track P3, migration 0027). Turns a workspace's
// active tenancies into DRAFT rent invoices for one calendar month — no I/O, no
// Date.now() inside (the caller supplies `today`, same discipline as
// src/lib/occupancy/timeline.ts and src/lib/occupancy/rent-roll.ts). The caller
// (generateRentInvoicesAction, P3-2) loads tenancies + existing invoice keys via the RLS
// client, runs this, then inserts sequentially — a 23505 unique-violation from the
// invoices_tenancy_period_unique index (migration 0027) is the concurrent-click
// backstop; this planner's `existing` check is the friendly, non-error first line.

// One ISO calendar day, 'YYYY-MM-DD'.
type IsoDate = string

const MONTH_RE = /^\d{4}-\d{2}$/

// An already-billed (tenancy, month) pair the caller found in the DB for this month.
// `status` matters: a VOIDed invoice does NOT block regeneration (mirrors the partial
// unique index's `and status <> 'VOID'` clause exactly — the DB is the enforcement,
// this is the friendly pre-check that must agree with it).
export type ExistingInvoiceKey = {
  tenancyId: string
  billingPeriod: IsoDate
  status: InvoiceStatus
}

// The minimal unit shape the planner needs to resolve property_id attribution — not the
// full `Unit` row type (src/lib/data/units.ts), so this module stays decoupled from the
// units data layer and easy to construct in tests.
export type RecurringUnitRef = {
  id: string
  propertyId: string | null
}

export type PlannedInvoiceLine = {
  description: string
  quantity: number
  unitAmount: number
}

export type PlannedInvoice = {
  tenancyId: string
  unitId: string
  propertyId: string | null
  partyType: 'TENANT'
  partyName: string
  direction: 'OUTBOUND'
  status: 'DRAFT'
  billingPeriod: IsoDate // first day of the billed month
  issueDate: IsoDate
  dueDate: IsoDate
  currency: 'EUR'
  lines: [PlannedInvoiceLine]
}

export type RentInvoicePlan = {
  toCreate: PlannedInvoice[]
  skippedExisting: number
  skippedNoRent: number
}

const MS_PER_DAY = 86_400_000

// Parse a required 'YYYY-MM' input into its first/last calendar days. Throws on a
// malformed month — this is a programmer/contract error (the caller controls the format,
// e.g. an <input type="month"> value), not a data-quality issue to guard silently, unlike
// the null-safe date parsing in rent-roll.ts.
function monthBounds(month: string): { monthStart: IsoDate; monthEnd: IsoDate } {
  if (!MONTH_RE.test(month)) {
    throw new Error(`computeRentInvoicePlan: month must be 'YYYY-MM', got '${month}'`)
  }
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr) // 1-based
  const monthStart = `${yearStr}-${monthStr}-01`
  // Day 0 of the NEXT month = the last day of THIS month (UTC, avoids timezone drift).
  const monthEnd = new Date(Date.UTC(year, monthNum, 0)).toISOString().slice(0, 10)
  return { monthStart, monthEnd }
}

// `iso` + `days` calendar days later, UTC. Used for due_date = issue_date + 14.
function addDays(iso: IsoDate, days: number): IsoDate {
  const t = Date.parse(`${iso}T00:00:00Z`)
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10)
}

// today (a Date, so callers pass `new Date()` in production and a fixed date in tests —
// same pattern as rentRoll's `asOf`) as an ISO calendar day.
function isoOf(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

// True when a tenancy's [start_date, end_date] span (end_date inclusive, end_date null =
// open-ended) overlaps the closed [monthStart, monthEnd] range. Classic closed-interval
// overlap test: startA <= endB && startB <= endA. This matches the inclusive end_date
// convention already used by rent-roll.ts's `covers today` check (end_date >= asOf) — a
// tenancy whose end_date lands on the 1st of a month is still billed for that month (its
// last day of occupancy falls inside it). NOTE: this is a DELIBERATE divergence from
// timeline.ts's half-open [start, end) segmentation (there, the end_date day itself is
// already VACANT); the two files answer different questions (timeline draws a chart,
// rent-roll/this planner answer "is this tenancy billable for this whole month"), and the
// spec explicitly pins this exact formula (§2) — see recurring.test.ts for both boundary
// cases exercised against it.
function tenancyOverlapsMonth(t: Tenancy, monthStart: IsoDate, monthEnd: IsoDate): boolean {
  return t.start_date <= monthEnd && (t.end_date === null || t.end_date >= monthStart)
}

// rent_amount is a finite number > 0. Anything else (null, 0, negative, NaN) is treated
// as "no rent on file" — the tenancy is skipped, not billed for 0.
function hasBillableRent(t: Tenancy): t is Tenancy & { rent_amount: number } {
  return typeof t.rent_amount === 'number' && Number.isFinite(t.rent_amount) && t.rent_amount > 0
}

// Whether (tenancyId, month) already has a non-VOID invoice on file. A VOIDed invoice for
// the same key does not block a fresh DRAFT — that's the whole point of void+regenerate.
function alreadyBilled(
  existingByTenancy: Map<string, ExistingInvoiceKey[]>,
  tenancyId: string,
  monthStart: IsoDate,
): boolean {
  const keys = existingByTenancy.get(tenancyId)
  if (!keys) return false
  return keys.some((k) => k.billingPeriod === monthStart && k.status !== 'VOID')
}

/**
 * Plan DRAFT rent invoices for `month` ('YYYY-MM') from the workspace's tenancies.
 *
 * Qualification, in order (spec §2):
 * 1. The tenancy overlaps `month` (closed-interval, end_date inclusive) — tenancies that
 *    don't overlap contribute nothing and are not counted in either skip bucket.
 * 2. `rent_amount` is a finite number > 0 — else `skippedNoRent`.
 * 3. No existing non-VOID invoice for (tenancy_id, month) — else `skippedExisting`.
 *
 * `party_name` prefers the linked tenant directory record's full_name (P1, via
 * `tenantNames`, keyed by tenant_id) and falls back to the tenancy's own `tenant_name` —
 * so this works identically whether or not P1's tenant_id linkage is populated.
 * `property_id` is resolved from `units` (looked up by the tenancy's unit_id); a tenancy
 * whose unit is missing from `units` degrades to a null property_id rather than throwing,
 * since that's an attribution nicety, not a correctness requirement.
 */
export function computeRentInvoicePlan(
  tenancies: Tenancy[],
  units: RecurringUnitRef[],
  existing: ExistingInvoiceKey[],
  month: string,
  today: Date,
  tenantNames: Map<string, string> = new Map(),
): RentInvoicePlan {
  const { monthStart, monthEnd } = monthBounds(month)
  const todayIso = isoOf(today)
  const dueDate = addDays(todayIso, 14)
  const description = `Rent — ${formatMonth(month)}`

  const propertyByUnit = new Map(units.map((u) => [u.id, u.propertyId]))

  const existingByTenancy = new Map<string, ExistingInvoiceKey[]>()
  for (const key of existing) {
    const list = existingByTenancy.get(key.tenancyId)
    if (list) list.push(key)
    else existingByTenancy.set(key.tenancyId, [key])
  }

  const toCreate: PlannedInvoice[] = []
  let skippedExisting = 0
  let skippedNoRent = 0

  for (const t of tenancies) {
    if (!tenancyOverlapsMonth(t, monthStart, monthEnd)) continue

    if (!hasBillableRent(t)) {
      skippedNoRent++
      continue
    }

    if (alreadyBilled(existingByTenancy, t.id, monthStart)) {
      skippedExisting++
      continue
    }

    const partyName = (t.tenant_id && tenantNames.get(t.tenant_id)) || t.tenant_name

    toCreate.push({
      tenancyId: t.id,
      unitId: t.unit_id,
      propertyId: propertyByUnit.get(t.unit_id) ?? null,
      partyType: 'TENANT',
      partyName,
      direction: 'OUTBOUND',
      status: 'DRAFT',
      billingPeriod: monthStart,
      issueDate: todayIso,
      dueDate,
      currency: 'EUR',
      lines: [{ description, quantity: 1, unitAmount: t.rent_amount }],
    })
  }

  return { toCreate, skippedExisting, skippedNoRent }
}
