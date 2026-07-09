import { ChartColumn } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { listVendors } from '@/lib/data/vendors'
import { listUnits } from '@/lib/data/units'
import { listProperties } from '@/lib/data/properties'
import { listIncomeRecords, listExpenseRecords } from '@/lib/data/finance'
import {
  costOverview,
  costByCategory,
  costByProperty,
  vendorBenchmarks,
  problemUnits,
  cycleTimes,
  trends,
  profitPerUnit,
} from '@/lib/analytics/metrics'
import { can } from '@/lib/auth/permissions'
import type { TicketPriority } from '@/types/domain'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RankBars, TrendChart, type RankBarRow } from '@/components/insights/charts'
import { formatMoney, formatDays, formatCount } from '@/lib/insights/format'

// Turn an UPPER_SNAKE enum into a sentence-case-ish label ("APPLIANCE_REPAIR" →
// "appliance repair"), matching how categories read elsewhere in the app.
function humanize(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

const PRIORITY_ORDER: TicketPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT']

export default async function InsightsPage() {
  const user = await requirePermission('analytics:read')

  const supabase = await createClient()
  // Finance rows drive profit-per-unit; only fetch them when the role can read finance
  // (RLS would scope them anyway, but this skips the query for roles without the surface).
  const canReadFinance = can(user.role, 'finance:read')
  const [tickets, vendors, units, properties, income, expenses] = await Promise.all([
    listTickets(supabase, user.workspaceId),
    listVendors(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
    canReadFinance ? listIncomeRecords(supabase, user.workspaceId) : Promise.resolve([]),
    canReadFinance ? listExpenseRecords(supabase, user.workspaceId) : Promise.resolve([]),
  ])

  if (tickets.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Insights"
          subtitle="Spend, vendors, and cycle times across the portfolio."
        />
        <EmptyState
          icon={<ChartColumn />}
          title="No tickets to analyse yet"
          body="Log maintenance tickets with costs and outcomes, and this page fills in spend, vendor benchmarks, and cycle times."
        />
      </div>
    )
  }

  const overview = costOverview(tickets)
  const categories = costByCategory(tickets)
  const byProperty = costByProperty(tickets, properties)
  const benchmarks = vendorBenchmarks(tickets, vendors)
  const units5 = problemUnits(tickets, units, properties, 5)
  const cycles = cycleTimes(tickets)
  const monthly = trends(tickets)
  // Profit per unit = Σ income − Σ maintenance cost per unit. Empty until finance rows
  // exist; a unit with cost but no income shows negative (cost-only).
  const profit = canReadFinance ? profitPerUnit(income, expenses, tickets, units, properties) : []

  const categoryRows: RankBarRow[] = categories
    .filter((c) => c.total > 0)
    .map((c) => ({
      key: c.category,
      label: humanize(c.category),
      sublabel: `${formatCount(c.count)} ${c.count === 1 ? 'ticket' : 'tickets'}`,
      value: c.total,
      display: formatMoney(c.total),
    }))

  const propertyRows: RankBarRow[] = byProperty
    .filter((p) => p.total > 0)
    .map((p) => ({
      key: p.propertyId,
      label: p.propertyName,
      sublabel: `${formatCount(p.count)} ${p.count === 1 ? 'ticket' : 'tickets'}`,
      value: p.total,
      display: formatMoney(p.total),
      // Drill into this property's tickets (the tickets page validates ?propertyId=).
      href: `/tickets?propertyId=${p.propertyId}`,
    }))

  const unitRows: RankBarRow[] = units5.map((u) => ({
    key: u.unitId,
    label: u.label,
    sublabel: `${u.propertyName} · ${formatMoney(u.totalCost)}`,
    value: u.ticketCount,
    display: `${formatCount(u.ticketCount)} ${u.ticketCount === 1 ? 'ticket' : 'tickets'}`,
    // Drill into the unit hub for the full maintenance history.
    href: `/units/${u.unitId}`,
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Insights"
        subtitle="Spend, vendors, and cycle times across the portfolio."
      />

      {/* Top metric strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total spend" value={formatMoney(overview.totalActualCost)} />
        <Metric label="Open-cost exposure" value={formatMoney(overview.openCostExposure)} />
        <Metric label="Avg resolve time" value={formatDays(cycles.avgResolveDays)} />
        <Metric label="Tickets" value={formatCount(tickets.length)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Cost by category */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryRows.length > 0 ? (
              <RankBars rows={categoryRows} />
            ) : (
              <NoData>No recorded costs yet.</NoData>
            )}
          </CardContent>
        </Card>

        {/* Cost by property */}
        <Card>
          <CardHeader>
            <CardTitle>Cost by property</CardTitle>
          </CardHeader>
          <CardContent>
            {propertyRows.length > 0 ? (
              <RankBars rows={propertyRows} />
            ) : (
              <NoData>No recorded costs yet.</NoData>
            )}
          </CardContent>
        </Card>

        {/* Vendor benchmarking */}
        <Card>
          <CardHeader>
            <CardTitle>Vendor benchmarking</CardTitle>
          </CardHeader>
          <CardContent>
            {benchmarks.length > 0 ? (
              <VendorTable rows={benchmarks} />
            ) : (
              <NoData>No vendor-assigned tickets yet.</NoData>
            )}
          </CardContent>
        </Card>

        {/* Problem units */}
        <Card>
          <CardHeader>
            <CardTitle>Problem units</CardTitle>
          </CardHeader>
          <CardContent>
            {unitRows.length > 0 ? (
              <RankBars rows={unitRows} />
            ) : (
              <NoData>No unit-level tickets yet.</NoData>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trends — full width */}
      <Card>
        <CardHeader>
          <CardTitle>Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <TrendChart points={monthly} />
        </CardContent>
      </Card>

      {/* Profit per unit — only shown to finance-readers, and only once finance rows
          exist. Income − maintenance cost per unit; cost-only units read negative. */}
      {canReadFinance && (
        <Card>
          <CardHeader>
            <CardTitle>Profit per unit</CardTitle>
          </CardHeader>
          <CardContent>
            {profit.length > 0 ? (
              <ProfitTable rows={profit} />
            ) : (
              <NoData>No finance entries yet — add income and expenses to see profit.</NoData>
            )}
          </CardContent>
        </Card>
      )}

      {/* Cycle time by priority */}
      <Card>
        <CardHeader>
          <CardTitle>Cycle time by priority</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PRIORITY_ORDER.map((p) => (
              <div key={p} className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2.5">
                <dt className="text-xs text-muted-foreground capitalize">{humanize(p)}</dt>
                <dd className="text-lg font-semibold tabular-nums text-foreground">
                  {formatDays(cycles.byPriority[p])}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </span>
      </CardContent>
    </Card>
  )
}

function NoData({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-sm text-muted-foreground">{children}</p>
}

function ProfitTable({
  rows,
}: {
  rows: Array<{
    unitId: string
    label: string
    propertyName: string
    income: number
    cost: number
    profit: number
  }>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Unit</th>
            <th className="pb-2 text-right font-medium">Income</th>
            <th className="pb-2 text-right font-medium">Cost</th>
            <th className="pb-2 text-right font-medium">Profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.unitId} className="border-b last:border-b-0 align-top">
              <td className="py-2 pr-2 font-medium text-foreground">
                {u.label}
                <span className="block text-xs font-normal text-muted-foreground">
                  {u.propertyName}
                </span>
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {formatMoney(u.income)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {formatMoney(u.cost)}
              </td>
              <td
                className={
                  'py-2 text-right tabular-nums font-medium ' +
                  (u.profit < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400')
                }
              >
                {formatMoney(u.profit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function VendorTable({
  rows,
}: {
  rows: Array<{
    vendorId: string
    name: string
    jobs: number
    avgActualCost: number | null
    avgCycleDays: number | null
    openCount: number
  }>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Vendor</th>
            <th className="pb-2 text-right font-medium">Jobs</th>
            <th className="pb-2 text-right font-medium">Avg cost</th>
            <th className="pb-2 text-right font-medium">Avg cycle</th>
            <th className="pb-2 text-right font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.vendorId} className="border-b last:border-b-0">
              <td className="py-2 pr-2 font-medium text-foreground">{v.name}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {formatCount(v.jobs)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {v.avgActualCost === null ? '—' : formatMoney(v.avgActualCost)}
              </td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">
                {formatDays(v.avgCycleDays)}
              </td>
              <td className="py-2 text-right">
                {v.openCount > 0 ? (
                  <Badge variant="amber">{formatCount(v.openCount)}</Badge>
                ) : (
                  <span className="tabular-nums text-muted-foreground">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
