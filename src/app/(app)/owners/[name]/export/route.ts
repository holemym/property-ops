import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { routeMfaSatisfied } from '@/lib/auth/route-guard'
import { createClient } from '@/lib/supabase/server'
import { listInvoices, listLineItemsForWorkspace } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import { summarizeOwners, type OwnerInvoiceRow } from '@/lib/invoices/owners'

// GET /owners/<name>/export — a single owner's statement as CSV: every OWNER-party invoice
// billed to that party_name (each row carrying its own currency), plus a trailing Billed /
// Paid / Outstanding summary PER CURRENCY (via summarizeOwners — amounts are never summed
// across currencies). Same auth shape as /finance/export and /invoices/export: resolve the
// user directly and return 401/403 rather than requirePermission's redirect, since this is a
// Route Handler. RLS scopes the reads to the workspace under the finance SELECT policy.

const HEADERS = ['Invoice number', 'Issue date', 'Due date', 'Status', 'Currency', 'Total'] as const

// RFC 4180 field escaping: wrap in quotes and double any embedded quotes when the value
// contains a comma, quote, or newline. Null becomes an empty field.
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Turn an owner name into a filesystem-safe slug for the download filename: keep
// alphanumerics, collapse everything else to a single hyphen, trim, and cap length.
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'owner'
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
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

  const { name: rawName } = await params
  const name = decodeURIComponent(rawName)

  const supabase = await createClient()
  const [invoices, lineItems] = await Promise.all([
    listInvoices(supabase, user.workspaceId, { partyType: 'OWNER' }),
    listLineItemsForWorkspace(supabase, user.workspaceId),
  ])

  const owned = invoices.filter((inv) => inv.party_name === name)
  if (owned.length === 0) {
    return new Response('Owner not found', { status: 404 })
  }

  const linesByInvoice = new Map<string, { quantity: number; unit_amount: number }[]>()
  for (const l of lineItems) {
    const list = linesByInvoice.get(l.invoice_id)
    if (list) list.push(l)
    else linesByInvoice.set(l.invoice_id, [l])
  }
  const totalFor = (id: string, taxRate: number) =>
    invoiceTotals(linesByInvoice.get(id) ?? [], taxRate).total

  const sorted = owned
    .slice()
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date))

  const summaryRows: OwnerInvoiceRow[] = owned.map((inv) => ({
    name: inv.party_name,
    currency: inv.currency,
    total: totalFor(inv.id, inv.tax_rate),
    status: inv.status,
  }))
  const summary = summarizeOwners(summaryRows)[0]

  const dataRows = sorted.map((inv) =>
    [
      inv.invoice_number,
      inv.issue_date,
      inv.due_date,
      inv.status,
      inv.currency,
      totalFor(inv.id, inv.tax_rate),
    ]
      .map(csvField)
      .join(','),
  )

  // Trailing summary rows: a blank separator then Billed / Paid / Outstanding per
  // currency, each as a labelled row under the "Invoice number" / "Currency" / "Total"
  // columns. Single-currency owners (the overwhelming case) get exactly one triple.
  const summaryLines = ['']
  for (const t of summary.totals) {
    summaryLines.push(
      ['Billed', '', '', '', t.currency, t.billed].map(csvField).join(','),
      ['Paid', '', '', '', t.currency, t.paid].map(csvField).join(','),
      ['Outstanding', '', '', '', t.currency, t.outstanding].map(csvField).join(','),
    )
  }

  const lines = [HEADERS.join(','), ...dataRows, ...summaryLines]
  // Leading BOM so Excel opens UTF-8 owner names (umlauts etc.) correctly.
  const body = '﻿' + lines.join('\r\n') + '\r\n'

  const filename = `statement-${slugify(name)}-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
