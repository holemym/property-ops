import type { Ticket } from '@/lib/data/tickets'
import type { Vendor } from '@/lib/data/vendors'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'
import type { TicketCategory, TicketPriority, TicketStatus } from '@/types/domain'

// Pure, DB-free analytics over already-fetched rows. Nothing here touches Supabase —
// callers fetch tickets/vendors/units/properties (RLS-scoped) then hand the arrays in,
// which keeps every function individually unit-testable. All money is a plain number in
// the workspace currency (EUR in the MVP); rounding for display is the caller's job.
//
// Guards throughout: costs and timestamps are nullable on tickets, and inputs may be
// empty. Every function returns zeros / empty arrays instead of NaN or throwing.

// Ticket statuses that are NOT terminal — a ticket in one of these is still live work,
// so its estimated_cost counts as open-cost exposure. Mirrors the occupancy page's
// TERMINAL_STATUSES ('RESOLVED','CLOSED','CANCELLED'), inverted.
const NON_TERMINAL_STATUSES: ReadonlySet<TicketStatus> = new Set<TicketStatus>([
  'NEW',
  'TRIAGE',
  'WAITING_FOR_INFO',
  'ASSIGNED',
  'SCHEDULED',
  'IN_PROGRESS',
])

function isNonTerminal(status: TicketStatus): boolean {
  return NON_TERMINAL_STATUSES.has(status)
}

// A ticket is "resolved" for cycle-time / trend purposes once it carries a resolved_at
// or closed_at stamp. We take whichever exists (resolved first), so a resolve→close
// keeps the earlier resolve time as the cycle end.
function completedAt(ticket: Pick<Ticket, 'resolved_at' | 'closed_at'>): string | null {
  return ticket.resolved_at ?? ticket.closed_at ?? null
}

// Whole days between two ISO timestamps, floored at 0. Returns null if either bound is
// missing or unparseable, so callers can skip the row rather than average in a NaN.
function cycleDays(createdAt: string | null, endAt: string | null): number | null {
  if (!createdAt || !endAt) return null
  const start = Date.parse(createdAt)
  const end = Date.parse(endAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  const days = (end - start) / 86_400_000
  return days < 0 ? 0 : days
}

// Average of a numeric list, or null when empty (never NaN).
function average(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((acc, n) => acc + n, 0)
  return sum / values.length
}

// A non-null, finite numeric cost, or 0. Coerces null/NaN away in one place.
function cost(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// ---------------------------------------------------------------------------
// Cost overview
// ---------------------------------------------------------------------------

export type CostOverview = {
  totalActualCost: number
  totalEstimatedCost: number
  // Σ estimated_cost of tickets still in a non-terminal status — money committed but
  // not yet spent.
  openCostExposure: number
  // actual − estimated: positive = over budget, negative = under.
  variance: number
}

export function costOverview(tickets: Ticket[]): CostOverview {
  let totalActualCost = 0
  let totalEstimatedCost = 0
  let openCostExposure = 0
  for (const t of tickets) {
    totalActualCost += cost(t.actual_cost)
    totalEstimatedCost += cost(t.estimated_cost)
    if (isNonTerminal(t.status)) openCostExposure += cost(t.estimated_cost)
  }
  return {
    totalActualCost,
    totalEstimatedCost,
    openCostExposure,
    variance: totalActualCost - totalEstimatedCost,
  }
}

// ---------------------------------------------------------------------------
// Cost by category
// ---------------------------------------------------------------------------

export type CategoryCost = {
  category: TicketCategory
  total: number
  count: number
}

// Total actual_cost per ticket category, sorted desc by total. Categories with no
// tickets are omitted. count is the number of tickets in the category (regardless of
// whether they carry a cost).
export function costByCategory(tickets: Ticket[]): CategoryCost[] {
  const byCategory = new Map<TicketCategory, { total: number; count: number }>()
  for (const t of tickets) {
    const entry = byCategory.get(t.category) ?? { total: 0, count: 0 }
    entry.total += cost(t.actual_cost)
    entry.count += 1
    byCategory.set(t.category, entry)
  }
  return [...byCategory.entries()]
    .map(([category, { total, count }]) => ({ category, total, count }))
    .sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------
// Cost by property
// ---------------------------------------------------------------------------

export type PropertyCost = {
  propertyId: string
  propertyName: string
  total: number
  count: number
}

// Total actual_cost per property, sorted desc by total. Every ticket carries a
// property_id; a property with no matching row in `properties` falls back to a generic
// label rather than being dropped.
export function costByProperty(tickets: Ticket[], properties: Property[]): PropertyCost[] {
  const nameById = new Map(properties.map((p) => [p.id, p.name]))
  const byProperty = new Map<string, { total: number; count: number }>()
  for (const t of tickets) {
    const entry = byProperty.get(t.property_id) ?? { total: 0, count: 0 }
    entry.total += cost(t.actual_cost)
    entry.count += 1
    byProperty.set(t.property_id, entry)
  }
  return [...byProperty.entries()]
    .map(([propertyId, { total, count }]) => ({
      propertyId,
      propertyName: nameById.get(propertyId) ?? 'Unknown property',
      total,
      count,
    }))
    .sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------------------
// Vendor benchmarking
// ---------------------------------------------------------------------------

export type VendorBenchmark = {
  vendorId: string
  name: string
  // Tickets assigned to this vendor (any status).
  jobs: number
  // Mean actual_cost over the vendor's tickets that carry a non-null actual_cost, or
  // null when none do.
  avgActualCost: number | null
  // Mean created_at→resolved_at/closed_at days over the vendor's resolved/closed
  // tickets, or null when none are complete.
  avgCycleDays: number | null
  // Tickets still in a non-terminal status.
  openCount: number
}

// One row per vendor that has at least one assigned ticket, sorted desc by jobs (ties
// broken by name). Vendors with zero assigned tickets are omitted — the benchmark is
// about work handled, not the vendor roster.
export function vendorBenchmarks(tickets: Ticket[], vendors: Vendor[]): VendorBenchmark[] {
  const nameById = new Map(vendors.map((v) => [v.id, v.company_name]))
  const byVendor = new Map<
    string,
    { jobs: number; costs: number[]; cycles: number[]; openCount: number }
  >()
  for (const t of tickets) {
    if (!t.assigned_vendor_id) continue
    const entry =
      byVendor.get(t.assigned_vendor_id) ?? { jobs: 0, costs: [], cycles: [], openCount: 0 }
    entry.jobs += 1
    if (typeof t.actual_cost === 'number' && Number.isFinite(t.actual_cost)) {
      entry.costs.push(t.actual_cost)
    }
    if (isNonTerminal(t.status)) {
      entry.openCount += 1
    } else {
      const days = cycleDays(t.created_at, completedAt(t))
      if (days !== null) entry.cycles.push(days)
    }
    byVendor.set(t.assigned_vendor_id, entry)
  }
  return [...byVendor.entries()]
    .map(([vendorId, { jobs, costs, cycles, openCount }]) => ({
      vendorId,
      name: nameById.get(vendorId) ?? 'Unknown vendor',
      jobs,
      avgActualCost: average(costs),
      avgCycleDays: average(cycles),
      openCount,
    }))
    .sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Problem-unit ranking
// ---------------------------------------------------------------------------

export type ProblemUnit = {
  unitId: string
  label: string
  propertyName: string
  ticketCount: number
  totalCost: number
}

// Units ranked by ticket count then total actual_cost, capped at `topN`. Only tickets
// that carry a unit_id count. Property name is resolved for context; a missing
// property/unit falls back to a generic label rather than being dropped.
export function problemUnits(
  tickets: Ticket[],
  units: Unit[],
  properties: Property[],
  topN = 5
): ProblemUnit[] {
  const unitById = new Map(units.map((u) => [u.id, u]))
  const propertyNameById = new Map(properties.map((p) => [p.id, p.name]))
  const byUnit = new Map<string, { ticketCount: number; totalCost: number }>()
  for (const t of tickets) {
    if (!t.unit_id) continue
    const entry = byUnit.get(t.unit_id) ?? { ticketCount: 0, totalCost: 0 }
    entry.ticketCount += 1
    entry.totalCost += cost(t.actual_cost)
    byUnit.set(t.unit_id, entry)
  }
  return [...byUnit.entries()]
    .map(([unitId, { ticketCount, totalCost }]) => {
      const unit = unitById.get(unitId)
      return {
        unitId,
        label: unit?.label ?? 'Unknown unit',
        propertyName: unit
          ? propertyNameById.get(unit.property_id) ?? 'Unknown property'
          : 'Unknown property',
        ticketCount,
        totalCost,
      }
    })
    .sort((a, b) => b.ticketCount - a.ticketCount || b.totalCost - a.totalCost)
    .slice(0, Math.max(0, topN))
}

// ---------------------------------------------------------------------------
// Cycle times
// ---------------------------------------------------------------------------

export type CycleTimes = {
  // Mean resolve time (days) over all resolved/closed tickets, or null when none.
  avgResolveDays: number | null
  byPriority: Record<TicketPriority, number | null>
}

const PRIORITIES: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

// Average time-to-resolve over resolved/closed tickets, overall and split by priority.
// A ticket only counts once it has a completion stamp (resolved_at/closed_at) and a
// parseable created_at. Priorities with no completed tickets return null.
export function cycleTimes(tickets: Ticket[]): CycleTimes {
  const all: number[] = []
  const byPriorityValues: Record<TicketPriority, number[]> = {
    LOW: [],
    NORMAL: [],
    HIGH: [],
    URGENT: [],
  }
  for (const t of tickets) {
    const days = cycleDays(t.created_at, completedAt(t))
    if (days === null) continue
    all.push(days)
    byPriorityValues[t.priority].push(days)
  }
  const byPriority = {} as Record<TicketPriority, number | null>
  for (const p of PRIORITIES) byPriority[p] = average(byPriorityValues[p])
  return { avgResolveDays: average(all), byPriority }
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export type TrendBucket = {
  // 'YYYY-MM'
  month: string
  // Tickets created in the month.
  opened: number
  // Tickets whose resolved_at/closed_at falls in the month.
  resolved: number
  // Σ actual_cost of tickets resolved in the month.
  spend: number
}

// 'YYYY-MM' of an ISO timestamp, or null if missing/unparseable.
function monthKey(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 7)
}

// The last `months` YYYY-MM keys ending at (and including) the month of `now`, oldest
// first. Deterministic given `now`, so it's testable without mocking the clock.
function recentMonths(now: Date, months: number): string[] {
  const keys: string[] = []
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0-based
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1))
    keys.push(d.toISOString().slice(0, 7))
  }
  return keys
}

// Monthly opened/resolved/spend over the last `months` buckets ending at `now`'s month.
// Opened is keyed on created_at; resolved and spend on the completion stamp. Buckets
// outside the window are ignored; every in-window month appears (zero-filled), oldest
// first, so a sparse dataset still renders a continuous axis.
export function trends(tickets: Ticket[], now: Date = new Date(), months = 6): TrendBucket[] {
  const window = recentMonths(now, months)
  const inWindow = new Set(window)
  const opened = new Map<string, number>()
  const resolved = new Map<string, number>()
  const spend = new Map<string, number>()
  for (const t of tickets) {
    const openedKey = monthKey(t.created_at)
    if (openedKey && inWindow.has(openedKey)) {
      opened.set(openedKey, (opened.get(openedKey) ?? 0) + 1)
    }
    const doneKey = monthKey(completedAt(t))
    if (doneKey && inWindow.has(doneKey)) {
      resolved.set(doneKey, (resolved.get(doneKey) ?? 0) + 1)
      spend.set(doneKey, (spend.get(doneKey) ?? 0) + cost(t.actual_cost))
    }
  }
  return window.map((month) => ({
    month,
    opened: opened.get(month) ?? 0,
    resolved: resolved.get(month) ?? 0,
    spend: spend.get(month) ?? 0,
  }))
}
