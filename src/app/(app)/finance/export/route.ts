import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { routeMfaSatisfied } from '@/lib/auth/route-guard'
import { createClient } from '@/lib/supabase/server'
import { listIncomeRecords, listExpenseRecords } from '@/lib/data/finance'
import type { IncomeRecord, ExpenseRecord } from '@/types/domain'

// GET /finance/export — streams the workspace's income + expense records as a single CSV.
// Reads are RLS-scoped (listIncome/ExpenseRecords filter by workspace_id under the finance
// SELECT policy), and this handler gates on finance:read on top. A Route Handler can't use
// requirePermission (it redirect()s / throws for the page error boundary), so we resolve
// the user directly and return 401/403 instead.
//
// One row per record with a `type` column (income|expense) so both series land in one
// file. Dates use each record's defining date (income → period_start, expense →
// incurred_on) under a shared `date` column; period_end / ticket_id are their own columns.

const HEADERS = [
  'type',
  'date',
  'period_end',
  'amount',
  'currency',
  'category',
  'property_id',
  'unit_id',
  'ticket_id',
  'notes',
  'created_at',
] as const

// RFC 4180 field escaping: wrap in quotes and double any embedded quotes when the value
// contains a comma, quote, or newline. Null becomes an empty field.
function csvField(value: string | number | null): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function incomeRow(r: IncomeRecord): string {
  return [
    'income',
    r.period_start,
    r.period_end,
    r.amount,
    r.currency,
    r.category,
    r.property_id,
    r.unit_id,
    null,
    r.notes,
    r.created_at,
  ]
    .map(csvField)
    .join(',')
}

function expenseRow(r: ExpenseRecord): string {
  return [
    'expense',
    r.incurred_on,
    null,
    r.amount,
    r.currency,
    r.category,
    r.property_id,
    r.unit_id,
    r.ticket_id,
    r.notes,
    r.created_at,
  ]
    .map(csvField)
    .join(',')
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return new Response('Not authenticated', { status: 401 })
  }
  if (!user.workspaceId || !can(user.role, 'finance:read')) {
    return new Response('Not permitted', { status: 403 })
  }
  // MFA step-up: an enrolled user's AAL1 session (challenge still pending) must not
  // pull CSVs the page layer would block — see route-guard.ts.
  if (!(await routeMfaSatisfied())) {
    return new Response('Two-factor challenge required', { status: 401 })
  }

  const supabase = await createClient()
  const [income, expenses] = await Promise.all([
    listIncomeRecords(supabase, user.workspaceId),
    listExpenseRecords(supabase, user.workspaceId),
  ])

  const lines = [
    HEADERS.join(','),
    ...income.map(incomeRow),
    ...expenses.map(expenseRow),
  ]
  // Leading BOM so Excel opens UTF-8 notes (umlauts etc.) correctly.
  const body = '﻿' + lines.join('\r\n') + '\r\n'

  const filename = `finance-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
