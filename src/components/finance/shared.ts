import type { IncomeCategory, ExpenseCategory, IncomeRecord, ExpenseRecord } from '@/types/domain'
import type { MonthPoint } from './MonthBars'

// Shared, dependency-free helpers for the finance surface. Money is EUR, whole-euro
// (no cents on aggregates or entries — matches the insights charts' formatMoney).
const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

// A signed EUR string for net figures — an explicit − for losses so the sign reads at a
// glance (Intl already renders the minus, but a leading + on gains does not exist).
export function formatSignedMoney(value: number): string {
  const rounded = Math.round(value)
  return rounded > 0 ? `+${money.format(rounded)}` : money.format(rounded)
}

// 'YYYY-MM-DD' → a short human date ('1 Jun 2026'). Falls back to the raw string if
// unparseable so a bad row still renders something.
const dateFmt = new Intl.DateTimeFormat('en-IE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso
  return dateFmt.format(new Date(t))
}

// 'YYYY-MM' → 'Jun 2026' for the month bar-chart axis / net-by-month rows.
export function formatMonth(month: string): string {
  const t = Date.parse(`${month}-01T00:00:00Z`)
  if (Number.isNaN(t)) return month
  return new Intl.DateTimeFormat('en-IE', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(t))
}

// UPPER_SNAKE enum → sentence-case-ish label ('RENT' → 'rent'), matching how categories
// read elsewhere in the app.
export function humanizeCategory(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase()
}

// The income/expense category enums, ordered for the entry-form selects. Kept here (not
// re-derived from the DB) so the forms have a stable, human-ordered list.
export const INCOME_CATEGORIES: IncomeCategory[] = ['RENT', 'DEPOSIT', 'FEE', 'OTHER']

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'MAINTENANCE',
  'UTILITIES',
  'TAX',
  'INSURANCE',
  'MANAGEMENT',
  'OTHER',
]

// A finite number or 0 — coerces null/NaN away in one place.
function num(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// 'YYYY-MM' of an ISO date/timestamp, or null if missing/unparseable.
function monthKey(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t).toISOString().slice(0, 7)
}

// The last `months` 'YYYY-MM' keys ending at (and including) `now`'s month, oldest
// first. Deterministic given `now` (UTC), so it renders a continuous axis on sparse data.
function recentMonths(now: Date, months: number): string[] {
  const keys: string[] = []
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  for (let i = months - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(year, month - i, 1)).toISOString().slice(0, 7))
  }
  return keys
}

// Bucket income (by period_start) and expense (by incurred_on) into the last `months`
// months, zero-filled and oldest-first, for the income-vs-expense bar chart. Pure and
// deterministic given `now`.
export function incomeExpenseByMonth(
  income: IncomeRecord[],
  expenses: ExpenseRecord[],
  now: Date = new Date(),
  months = 6
): MonthPoint[] {
  const window = recentMonths(now, months)
  const inWindow = new Set(window)
  const incomeByMonth = new Map<string, number>()
  const expenseByMonth = new Map<string, number>()

  for (const r of income) {
    const key = monthKey(r.period_start)
    if (key && inWindow.has(key)) {
      incomeByMonth.set(key, (incomeByMonth.get(key) ?? 0) + num(r.amount))
    }
  }
  for (const e of expenses) {
    const key = monthKey(e.incurred_on)
    if (key && inWindow.has(key)) {
      expenseByMonth.set(key, (expenseByMonth.get(key) ?? 0) + num(e.amount))
    }
  }

  return window.map((month) => ({
    month,
    income: incomeByMonth.get(month) ?? 0,
    expense: expenseByMonth.get(month) ?? 0,
  }))
}

// Sum of a record list's amount, null-safe.
export function sumAmount(records: Array<{ amount: number | null }>): number {
  return records.reduce((acc, r) => acc + num(r.amount), 0)
}

// Net (income − expense) for the current calendar month, keyed on period_start /
// incurred_on. Used for the "this month" metric.
export function netThisMonth(
  income: IncomeRecord[],
  expenses: ExpenseRecord[],
  now: Date = new Date()
): number {
  const key = now.toISOString().slice(0, 7)
  let net = 0
  for (const r of income) if (monthKey(r.period_start) === key) net += num(r.amount)
  for (const e of expenses) if (monthKey(e.incurred_on) === key) net -= num(e.amount)
  return net
}
