'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { isDemoWorkspace } from '@/lib/demo'
import { invoiceFormSchema, invoiceStatusSchema, rentMonthSchema } from '@/lib/validation/invoice'
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  replaceInvoiceLines,
  setInvoiceStatus,
  listInvoiceLines,
} from '@/lib/data/invoices'
import { sendInvoiceEmail } from '@/lib/email/invoice'
import { getProperty } from '@/lib/data/properties'
import { getUnit, listUnits } from '@/lib/data/units'
import { getVendor } from '@/lib/data/vendors'
import { getTicket } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'
import { listTenants } from '@/lib/data/tenants'
import { computeRentInvoicePlan, type ExistingInvoiceKey } from '@/lib/invoices/recurring'
import { isMissingBillingPeriodColumnError } from '@/lib/invoices/degrade'
import type { InvoiceStatus } from '@/types/domain'

// Invoice write actions. Each gates on 'finance:write' FIRST (held by SUPER_ADMIN / OWNER /
// ACCOUNTANT — the same can_manage_finance() gate RLS enforces on invoices in 0019), then
// mutates via the authenticated (RLS-bound) createClient(). redirect/revalidatePath live
// OUTSIDE the try blocks (redirect throws NEXT_REDIRECT and must not be caught). Mirrors
// finance/actions.ts and tickets/actions.ts exactly.

// Lines are posted as a single JSON string in a hidden `lines` field (the InvoiceForm
// serialises its row editor to JSON). We parse it back to an array before handing the whole
// payload to invoiceFormSchema, which expects `lines: {description, quantity, unitAmount}[]`.
function parseLines(raw: FormData): unknown {
  const json = raw.get('lines')
  if (typeof json !== 'string') return []
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

function parseInvoiceForm(formData: FormData) {
  return invoiceFormSchema.safeParse({
    partyType: formData.get('partyType'),
    partyName: formData.get('partyName'),
    direction: formData.get('direction'),
    currency: formData.get('currency'),
    taxRate: formData.get('taxRate'),
    issueDate: formData.get('issueDate'),
    // '' (no due date / no attribution chosen) → null so the nullable/optional checks pass.
    dueDate: (formData.get('dueDate') as string | null) || null,
    recipientEmail: (formData.get('recipientEmail') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
    propertyId: (formData.get('propertyId') as string | null) || null,
    unitId: (formData.get('unitId') as string | null) || null,
    tenancyId: (formData.get('tenancyId') as string | null) || null,
    vendorId: (formData.get('vendorId') as string | null) || null,
    ticketId: (formData.get('ticketId') as string | null) || null,
    lines: parseLines(formData),
  })
}

// Friendly composite-ownership check: each attribution id is OPTIONAL. Before we write,
// confirm any non-null attribution belongs to the caller's workspace (the getX loaders are
// workspace-scoped, so an id from another workspace returns null and we redirect with a
// readable error) — mirrors the finance/ticket actions. The DB composite FKs (0019) are the
// un-bypassable backstop; these checks just turn a raw FK error into a friendly message.
async function validateAttributions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  data: {
    propertyId?: string | null
    unitId?: string | null
    tenancyId?: string | null
    vendorId?: string | null
    ticketId?: string | null
  },
  errorPath: string,
): Promise<void> {
  if (data.propertyId) {
    const property = await getProperty(supabase, workspaceId, data.propertyId)
    if (!property) redirectWithError(errorPath, 'Selected property was not found in your workspace.')
  }
  if (data.unitId) {
    const unit = await getUnit(supabase, workspaceId, data.unitId)
    if (!unit) redirectWithError(errorPath, 'Selected unit was not found in your workspace.')
  }
  if (data.vendorId) {
    const vendor = await getVendor(supabase, workspaceId, data.vendorId)
    if (!vendor) redirectWithError(errorPath, 'Selected vendor was not found in your workspace.')
  }
  if (data.ticketId) {
    const ticket = await getTicket(supabase, workspaceId, data.ticketId)
    if (!ticket) redirectWithError(errorPath, 'Selected ticket was not found in your workspace.')
  }
  // No getTenancy loader — confirm membership against the workspace roster instead.
  if (data.tenancyId) {
    const tenancies = await listTenancies(supabase, workspaceId)
    if (!tenancies.some((t) => t.id === data.tenancyId)) {
      redirectWithError(errorPath, 'Selected tenancy was not found in your workspace.')
    }
  }
}

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const parsed = parseInvoiceForm(formData)
  if (!parsed.success) {
    redirectWithError('/invoices/new', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  await validateAttributions(supabase, user.workspaceId, parsed.data, '/invoices/new')

  let invoiceId: string
  try {
    const invoice = await createInvoice(supabase, {
      workspaceId: user.workspaceId,
      createdByUserId: user.id,
      partyType: parsed.data.partyType,
      partyName: parsed.data.partyName,
      direction: parsed.data.direction,
      currency: parsed.data.currency,
      taxRate: parsed.data.taxRate,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate ?? null,
      recipientEmail: parsed.data.recipientEmail ?? null,
      notes: parsed.data.notes ?? null,
      propertyId: parsed.data.propertyId ?? null,
      unitId: parsed.data.unitId ?? null,
      tenancyId: parsed.data.tenancyId ?? null,
      vendorId: parsed.data.vendorId ?? null,
      ticketId: parsed.data.ticketId ?? null,
      lines: parsed.data.lines.map((l, i) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        sortOrder: i,
      })),
    })
    invoiceId = invoice.id
  } catch (e) {
    // redirectWithError throws NEXT_REDIRECT, so invoiceId is definitely assigned past here.
    redirectWithError('/invoices/new', e instanceof Error ? e.message : 'Could not create invoice.')
  }

  revalidatePath('/invoices')
  redirect(`/invoices/${invoiceId}`)
}

export async function updateInvoiceAction(id: string, formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const editPath = `/invoices/${id}/edit`
  const detailPath = `/invoices/${id}`

  const parsed = parseInvoiceForm(formData)
  if (!parsed.success) {
    redirectWithError(editPath, parsed.error.issues[0].message)
  }

  const supabase = await createClient()

  const existing = await getInvoice(supabase, user.workspaceId, id)
  if (!existing) redirectWithError(detailPath, 'Invoice not found.')

  await validateAttributions(supabase, user.workspaceId, parsed.data, editPath)

  try {
    await updateInvoice(supabase, user.workspaceId, id, {
      partyType: parsed.data.partyType,
      partyName: parsed.data.partyName,
      direction: parsed.data.direction,
      currency: parsed.data.currency,
      taxRate: parsed.data.taxRate,
      issueDate: parsed.data.issueDate,
      dueDate: parsed.data.dueDate ?? null,
      recipientEmail: parsed.data.recipientEmail ?? null,
      notes: parsed.data.notes ?? null,
      propertyId: parsed.data.propertyId ?? null,
      unitId: parsed.data.unitId ?? null,
      tenancyId: parsed.data.tenancyId ?? null,
      vendorId: parsed.data.vendorId ?? null,
      ticketId: parsed.data.ticketId ?? null,
    })
    await replaceInvoiceLines(
      supabase,
      user.workspaceId,
      id,
      parsed.data.lines.map((l, i) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        sortOrder: i,
      })),
    )
  } catch (e) {
    redirectWithError(editPath, e instanceof Error ? e.message : 'Could not update invoice.')
  }

  revalidatePath('/invoices')
  revalidatePath(detailPath)
  redirect(detailPath)
}

export async function setInvoiceStatusAction(id: string, formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const detailPath = `/invoices/${id}`

  const parsed = invoiceStatusSchema.safeParse({ status: formData.get('status') })
  if (!parsed.success) {
    redirectWithError(detailPath, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  const existing = await getInvoice(supabase, user.workspaceId, id)
  if (!existing) redirectWithError(detailPath, 'Invoice not found.')

  try {
    await setInvoiceStatus(supabase, user.workspaceId, id, parsed.data.status)
  } catch (e) {
    // 23505 = unique_violation. Re-opening a VOIDed rent invoice whose (tenancy, month)
    // has since been regenerated leaves the VOID carve-out of 0027's
    // invoices_tenancy_period_unique partial index and collides with the newer invoice —
    // surface that as guidance instead of the raw Postgres constraint message.
    if ((e as { code?: string })?.code === '23505') {
      redirectWithError(
        detailPath,
        'Rent for this period has already been re-invoiced — edit the newer invoice instead.',
      )
    }
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not update status.')
  }

  revalidatePath('/invoices')
  revalidatePath(detailPath)
  redirect(detailPath)
}

/**
 * Email the invoice to its recipient. Requires a recipient_email on the invoice (set via
 * Edit). Disconnected-safe: with no RESEND_API_KEY the send is a no-op and we tell the user
 * email isn't connected yet. On a real send, a DRAFT invoice advances to SENT so its status
 * reflects delivery. Gated on finance:write.
 */
export async function sendInvoiceAction(id: string): Promise<void> {
  const user = await requirePermission('finance:write')
  const detailPath = `/invoices/${id}`

  const supabase = await createClient()
  const invoice = await getInvoice(supabase, user.workspaceId, id)
  if (!invoice) redirectWithError(detailPath, 'Invoice not found.')

  const to = (invoice.recipient_email ?? '').trim()
  if (!to) {
    redirectWithError(detailPath, 'Add a recipient email (Edit the invoice) before sending.')
  }

  // D4 in-demo gate: never email a stranger's real inbox from the shared demo workspace.
  // The send is SIMULATED — sendInvoiceEmail is skipped entirely — but the invoice still
  // advances DRAFT -> SENT below (so the workflow reads correctly) and the success toast
  // says explicitly that it was a simulation.
  const demo = isDemoWorkspace(user.workspaceId)

  if (!demo) {
    const lines = await listInvoiceLines(supabase, user.workspaceId, id)
    // sendInvoiceEmail never throws (best-effort transport); branch on its result.
    const result = await sendInvoiceEmail(invoice, lines, to)
    if (result.status === 'disconnected') {
      redirectWithError(detailPath, 'Email isn’t connected yet — set RESEND_API_KEY to send invoices.')
    }
    if (!result.sent) {
      redirectWithError(detailPath, result.error ?? 'Could not send the invoice email.')
    }
  }

  // Reflect delivery: a DRAFT becomes SENT once it's actually emailed (or simulated).
  if (invoice.status === 'DRAFT') {
    try {
      await setInvoiceStatus(supabase, user.workspaceId, id, 'SENT')
    } catch (e) {
      console.error('Failed to advance invoice to SENT after email', id, e)
    }
  }

  revalidatePath(detailPath)
  redirect(`${detailPath}?sent=${demo ? 'demo' : '1'}`)
}

// Partial-select row shape for the `existing` dedupe-key query below — untyped
// `.select(cols)` results need an explicit cast (roadmap v2 §2's Supabase-select rule).
type ExistingInvoiceRow = { tenancy_id: string; billing_period: string; status: InvoiceStatus }

/**
 * "Generate rent" (Track P3, spec §3): drafts one DRAFT invoice per active tenancy with a
 * rent amount for the chosen month, deduped per (tenancy, month). Gated on finance:write
 * (the same can_manage_finance() tier as every other invoice write).
 *
 * DEGRADE-SAFE by design: migration 0027 (invoices.billing_period + the
 * invoices_tenancy_period_unique partial index) can land as a commit before a human
 * pastes it into the live Supabase SQL editor — the app stays live the whole time (same
 * ship-before-migration gap P1-2/P2-2 handled). The FIRST query below selects
 * billing_period, so if the column doesn't exist yet this throws immediately, before any
 * invoice is drafted — caught by isMissingBillingPeriodColumnError and turned into a
 * friendly `?error=` redirect (never a raw 500, never a partial run).
 *
 * DEDUPE CONTRACT (0027's migration header): the planner's own `existing` check is the
 * friendly first line; the DB's partial unique index is the actual guarantee under a
 * concurrent click. A 23505 unique-violation on an individual insert is caught here and
 * counted as skipped, never surfaced as an error.
 */
export async function generateRentInvoicesAction(formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const listPath = '/invoices'
  const degradeMessage =
    'Rent invoice generation isn’t set up yet — ask an admin to finish the pending database update.'

  const parsed = rentMonthSchema.safeParse({ month: formData.get('month') })
  if (!parsed.success) {
    redirectWithError(listPath, parsed.error.issues[0].message)
  }
  const { month } = parsed.data
  const monthStart = `${month}-01`

  const supabase = await createClient()

  const [tenancies, units] = await Promise.all([
    listTenancies(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
  ])

  // Tenant full-name resolution (P1's tenant_id linkage) is a display nicety, not the
  // point of this action — never let a tenants-table hiccup (e.g. migration 0025 not yet
  // applied in this environment) block rent-invoice generation, which only depends on
  // 0027. Falls back to each tenancy's own free-text tenant_name, exactly as if no
  // person were ever linked — same swallow-to-safe-default posture as the TopNav bell's
  // countUnread (src/app/(app)/layout.tsx, P2-2).
  const tenantNames = await listTenants(supabase, user.workspaceId)
    .then((tenants) => new Map(tenants.map((t) => [t.id, t.full_name])))
    .catch((e) => {
      console.error(
        'generateRentInvoicesAction: tenant directory lookup failed, falling back to tenancy.tenant_name',
        e,
      )
      return new Map<string, string>()
    })

  // The friendly first-line dedupe check (recurring.ts's `existing` param) — also the
  // FIRST place billing_period is queried, so a not-yet-applied migration 0027 surfaces
  // HERE, before any invoice is drafted.
  let existing: ExistingInvoiceKey[]
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('tenancy_id, billing_period, status')
      .eq('workspace_id', user.workspaceId)
      .eq('billing_period', monthStart)
      .not('tenancy_id', 'is', null)
    if (error) throw error
    const rows = (data ?? []) as unknown as ExistingInvoiceRow[]
    existing = rows.map((row) => ({
      tenancyId: row.tenancy_id,
      billingPeriod: row.billing_period,
      status: row.status,
    }))
  } catch (e) {
    if (isMissingBillingPeriodColumnError(e)) {
      redirectWithError(listPath, degradeMessage)
    }
    // Anything else unexpected here (network blip, RLS surprise, ...) — never leak a raw
    // error, same posture as every other action in this file.
    redirectWithError(listPath, e instanceof Error ? e.message : 'Could not check existing rent invoices.')
  }

  const plan = computeRentInvoicePlan(
    tenancies,
    units.map((u) => ({ id: u.id, propertyId: u.property_id })),
    existing,
    month,
    new Date(),
    tenantNames,
  )

  let created = 0
  let skipped = plan.skippedExisting

  for (const planned of plan.toCreate) {
    try {
      await createInvoice(supabase, {
        workspaceId: user.workspaceId,
        createdByUserId: user.id,
        partyType: planned.partyType,
        partyName: planned.partyName,
        direction: planned.direction,
        currency: planned.currency,
        taxRate: 0,
        issueDate: planned.issueDate,
        dueDate: planned.dueDate,
        propertyId: planned.propertyId,
        unitId: planned.unitId,
        tenancyId: planned.tenancyId,
        billingPeriod: planned.billingPeriod,
        lines: planned.lines.map((l, i) => ({
          description: l.description,
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          sortOrder: i,
        })),
      })
      created++
    } catch (e) {
      if (isMissingBillingPeriodColumnError(e)) {
        redirectWithError(listPath, degradeMessage)
      }
      if ((e as { code?: string })?.code === '23505') {
        // Concurrent-click backstop: migration 0027's invoices_tenancy_period_unique
        // index caught a (tenancy, month) pair our own pre-check above just missed.
        // Counted as skipped, never surfaced as an error.
        skipped++
        continue
      }
      redirectWithError(listPath, e instanceof Error ? e.message : 'Could not draft rent invoices.')
    }
  }

  revalidatePath(listPath)
  redirect(`${listPath}?generated=${created}&skipped=${skipped}`)
}
