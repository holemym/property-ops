import { getCurrentUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { routeMfaSatisfied } from '@/lib/auth/route-guard'
import { createClient } from '@/lib/supabase/server'
import { listInvoices, listLineItemsForWorkspace } from '@/lib/data/invoices'
import { invoiceTotals } from '@/lib/invoices/compute'
import {
  invoiceStatusEnum,
  invoicePartyTypeEnum,
  invoiceDirectionEnum,
} from '@/lib/validation/invoice'
import type {
  Invoice,
  InvoiceStatus,
  InvoicePartyType,
  InvoiceDirection,
} from '@/types/domain'

// GET /invoices/export — streams the workspace's invoices (honouring the same
// status/partyType/direction/propertyId filters and the Overdue quick filter as the list
// page) as a CSV. Reads are RLS-scoped
// (listInvoices filters by workspace_id under the finance SELECT policy) and this handler
// gates on finance:read on top. A Route Handler can't use requirePermission (it redirect()s
// / throws for the page error boundary), so we resolve the user directly and return 401/403
// instead — mirroring /finance/export.
//
// Unbounded on purpose: an explicit export should include every matching invoice, not just
// the current page. Line-item totals are computed in JS via invoiceTotals, grouped from a
// single listLineItemsForWorkspace fetch.

const HEADERS = [
  'Invoice number',
  'Party type',
  'Party name',
  'Direction',
  'Status',
  'Issue date',
  'Due date',
  'Currency',
  'Total',
  'Recipient email',
] as const

// RFC 4180 field escaping: wrap in quotes and double any embedded quotes when the value
// contains a comma, quote, or newline. Null becomes an empty field.
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(request: Request) {
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

  // Same enum guard as the invoices list page — invalid values are ignored rather than
  // 400-ing at PostgREST.
  const params = new URL(request.url).searchParams
  const rawStatus = params.get('status') ?? undefined
  const rawPartyType = params.get('partyType') ?? undefined
  const rawDirection = params.get('direction') ?? undefined
  const status = invoiceStatusEnum.safeParse(rawStatus).success
    ? (rawStatus as InvoiceStatus)
    : undefined
  const partyType = invoicePartyTypeEnum.safeParse(rawPartyType).success
    ? (rawPartyType as InvoicePartyType)
    : undefined
  const direction = invoiceDirectionEnum.safeParse(rawDirection).success
    ? (rawDirection as InvoiceDirection)
    : undefined
  // Same UUID guard + overdue flag shape as the invoices list page, so the export link's
  // carried params filter identically to the screen.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const rawPropertyId = params.get('propertyId') ?? undefined
  const propertyId = rawPropertyId && UUID_RE.test(rawPropertyId) ? rawPropertyId : undefined
  const overdue = params.get('overdue') === '1'

  const supabase = await createClient()
  const [invoices, lineItems] = await Promise.all([
    listInvoices(supabase, user.workspaceId, { status, partyType, direction, propertyId, overdue }),
    listLineItemsForWorkspace(supabase, user.workspaceId),
  ])

  const linesByInvoice = new Map<string, { quantity: number; unit_amount: number }[]>()
  for (const l of lineItems) {
    const list = linesByInvoice.get(l.invoice_id)
    if (list) list.push(l)
    else linesByInvoice.set(l.invoice_id, [l])
  }

  function invoiceRow(inv: Invoice): string {
    const { total } = invoiceTotals(linesByInvoice.get(inv.id) ?? [], inv.tax_rate)
    return [
      inv.invoice_number,
      inv.party_type,
      inv.party_name,
      inv.direction,
      inv.status,
      inv.issue_date,
      inv.due_date,
      inv.currency,
      total,
      inv.recipient_email,
    ]
      .map(csvField)
      .join(',')
  }

  const lines = [HEADERS.join(','), ...invoices.map(invoiceRow)]
  // Leading BOM so Excel opens UTF-8 party names (umlauts etc.) correctly.
  const body = '﻿' + lines.join('\r\n') + '\r\n'

  const filename = `invoices-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
