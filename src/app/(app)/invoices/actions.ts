'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { invoiceFormSchema, invoiceStatusSchema } from '@/lib/validation/invoice'
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  replaceInvoiceLines,
  setInvoiceStatus,
} from '@/lib/data/invoices'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor } from '@/lib/data/vendors'
import { getTicket } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'

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
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not update status.')
  }

  revalidatePath('/invoices')
  revalidatePath(detailPath)
  redirect(detailPath)
}
