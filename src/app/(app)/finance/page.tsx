import { Wallet, Download } from 'lucide-react'
import Link from 'next/link'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listIncomeRecords, listExpenseRecords } from '@/lib/data/finance'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTickets } from '@/lib/data/tickets'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonthBars } from '@/components/finance/MonthBars'
import { IncomeTable, ExpenseTable } from '@/components/finance/EntryTables'
import {
  AddIncomeDialog,
  AddExpenseDialog,
  type UnitOption,
} from '@/components/finance/AddEntryDialogs'
import {
  formatMoney,
  formatSignedMoney,
  incomeExpenseByMonth,
  sumAmount,
  netThisMonth,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
} from '@/components/finance/shared'
import { createIncomeAction, createExpenseAction } from './actions'

// How many recent entries to show in each table — the full ledger lives in the CSV
// export; the page is a scannable overview, not a paginated ledger.
const RECENT_LIMIT = 8

export default async function FinancePage() {
  const user = await requirePermission('finance:read')
  const canWrite = can(user.role, 'finance:write')

  const supabase = await createClient()
  const [income, expenses, properties, units, tickets] = await Promise.all([
    listIncomeRecords(supabase, user.workspaceId),
    listExpenseRecords(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listTickets(supabase, user.workspaceId),
  ])

  // Label + lookup maps for the entry tables and forms.
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitLabel = new Map(units.map((u) => [u.id, u.label]))
  const unitProperty = new Map(units.map((u) => [u.id, u.property_id]))
  const ticketTitle = new Map(tickets.map((t) => [t.id, t.title]))

  const labelFor = (r: { property_id: string | null; unit_id: string | null }): string | null => {
    if (r.unit_id) {
      const label = unitLabel.get(r.unit_id) ?? 'Unit'
      const propId = unitProperty.get(r.unit_id)
      const prop = propId ? propertyName.get(propId) : null
      return prop ? `${prop} · ${label}` : label
    }
    if (r.property_id) return propertyName.get(r.property_id) ?? 'Property'
    return null
  }

  const unitOptions: UnitOption[] = units.map((u) => ({
    id: u.id,
    label: u.label,
    propertyName: propertyName.get(u.property_id) ?? 'Unknown property',
  }))
  const ticketOptions = tickets.map((t) => ({ id: t.id, title: t.title }))

  const writeActions = canWrite ? (
    <>
      <AddIncomeDialog action={createIncomeAction} units={unitOptions} categories={INCOME_CATEGORIES} />
      <AddExpenseDialog
        action={createExpenseAction}
        units={unitOptions}
        categories={EXPENSE_CATEGORIES}
        tickets={ticketOptions}
      />
    </>
  ) : null

  const exportButton = (
    <Button size="sm" variant="outline" render={<Link href="/finance/export" />} nativeButton={false}>
      <Download />
      Export CSV
    </Button>
  )

  if (income.length === 0 && expenses.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <ErrorToast />
        <PageHeader
          title="Finance"
          subtitle="Income, expense, and the bottom line across the portfolio."
          actions={writeActions ?? undefined}
        />
        <EmptyState
          icon={<Wallet />}
          title="No entries yet"
          body={
            canWrite
              ? 'Add income and expense entries, and this page fills in totals, monthly trends, and per-unit profit.'
              : 'Once managers record income and expense entries, totals and monthly trends appear here.'
          }
          action={canWrite ? <AddIncomeDialog action={createIncomeAction} units={unitOptions} categories={INCOME_CATEGORIES} /> : undefined}
        />
      </div>
    )
  }

  const totalIncome = sumAmount(income)
  const totalExpense = sumAmount(expenses)
  const net = totalIncome - totalExpense
  const monthNet = netThisMonth(income, expenses)
  const monthly = incomeExpenseByMonth(income, expenses)

  // Recent entries — newest first by their defining date.
  const recentIncome = [...income]
    .sort((a, b) => b.period_start.localeCompare(a.period_start))
    .slice(0, RECENT_LIMIT)
  const recentExpenses = [...expenses]
    .sort((a, b) => b.incurred_on.localeCompare(a.incurred_on))
    .slice(0, RECENT_LIMIT)

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader
        title="Finance"
        subtitle="Income, expense, and the bottom line across the portfolio."
        actions={
          <>
            {exportButton}
            {writeActions}
          </>
        }
      />

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total income" value={formatMoney(totalIncome)} />
        <Metric label="Total expense" value={formatMoney(totalExpense)} />
        <Metric label="Net" value={formatSignedMoney(net)} tone={net < 0 ? 'loss' : 'gain'} />
        <Metric
          label="Net this month"
          value={formatSignedMoney(monthNet)}
          tone={monthNet < 0 ? 'loss' : 'gain'}
        />
      </div>

      {/* Income vs expense by month */}
      <Card>
        <CardHeader>
          <CardTitle>Income vs. expense by month</CardTitle>
        </CardHeader>
        <CardContent>
          <MonthBars points={monthly} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent income</CardTitle>
          </CardHeader>
          <CardContent>
            {recentIncome.length > 0 ? (
              <IncomeTable rows={recentIncome} labelFor={labelFor} />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No income recorded yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent expenses</CardTitle>
          </CardHeader>
          <CardContent>
            {recentExpenses.length > 0 ? (
              <ExpenseTable
                rows={recentExpenses}
                labelFor={labelFor}
                ticketTitleFor={(id) => ticketTitle.get(id) ?? null}
              />
            ) : (
              <p className="py-4 text-sm text-muted-foreground">No expenses recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'gain' | 'loss'
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={
            'text-2xl font-semibold tracking-tight tabular-nums ' +
            (tone === 'loss'
              ? 'text-red-600 dark:text-red-400'
              : tone === 'gain'
                ? 'text-green-700 dark:text-green-400'
                : 'text-foreground')
          }
        >
          {value}
        </span>
      </CardContent>
    </Card>
  )
}
