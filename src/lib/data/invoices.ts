import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Invoice,
  InvoiceLineItem,
  InvoiceStatus,
  InvoicePartyType,
  InvoiceDirection,
} from '@/types/domain'
import { formatInvoiceNumber } from '@/lib/invoices/compute'

// RLS scopes every query to the workspace + finance-eligible roles (0019). This layer
// applies the workspace scope + optional filters and shapes writes; it never sets the
// generated `amount` column on line items (the DB derives it from quantity × unit price).

export type InvoiceFilters = {
  status?: InvoiceStatus
  partyType?: InvoicePartyType
  direction?: InvoiceDirection
  propertyId?: string
}

export async function listInvoices(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: InvoiceFilters = {},
): Promise<Invoice[]> {
  let query = supabase.from('invoices').select('*').eq('workspace_id', workspaceId)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.partyType) query = query.eq('party_type', filters.partyType)
  if (filters.direction) query = query.eq('direction', filters.direction)
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Invoice[]
}

export async function getInvoice(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
): Promise<Invoice | null> {
  const { data, error } = await supabase
    .from('invoices').select('*').eq('workspace_id', workspaceId).eq('id', id).single()
  if (error) return null
  return data as Invoice
}

// Lines for ONE invoice, in display order.
export async function listInvoiceLines(
  supabase: SupabaseClient,
  workspaceId: string,
  invoiceId: string,
): Promise<InvoiceLineItem[]> {
  const { data, error } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('invoice_id', invoiceId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data as InvoiceLineItem[]
}

// All lines in the workspace — used by the list view to compute each invoice's total in
// one round-trip (grouped by invoice_id in JS) rather than N per-invoice queries. Fine at
// MVP scale; a stored/materialised total is the post-MVP optimisation.
export async function listLineItemsForWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<InvoiceLineItem[]> {
  const { data, error } = await supabase
    .from('invoice_line_items').select('*').eq('workspace_id', workspaceId)
  if (error) throw error
  return data as InvoiceLineItem[]
}

// Line items for a specific set of invoices (the current page) — bounds the fetch to the
// visible rows instead of pulling every line in the workspace.
export async function listLineItemsForInvoices(
  supabase: SupabaseClient,
  workspaceId: string,
  invoiceIds: string[],
): Promise<InvoiceLineItem[]> {
  if (invoiceIds.length === 0) return []
  const { data, error } = await supabase
    .from('invoice_line_items')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('invoice_id', invoiceIds)
  if (error) throw error
  return data as InvoiceLineItem[]
}

export type InvoicePage = {
  rows: Invoice[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

const DEFAULT_INVOICE_PAGE_SIZE = 25

/**
 * Paginated invoice list (created_at desc). Counts + windows at the DB so the list — and
 * the follow-up per-page line-item fetch — stay bounded. Page is clamped to range.
 */
export async function listInvoicesPage(
  supabase: SupabaseClient,
  workspaceId: string,
  params: { filters?: InvoiceFilters; page?: number; pageSize?: number } = {},
): Promise<InvoicePage> {
  const pageSize = params.pageSize ?? DEFAULT_INVOICE_PAGE_SIZE
  const f = params.filters ?? {}

  let countQuery = supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  if (f.status) countQuery = countQuery.eq('status', f.status)
  if (f.partyType) countQuery = countQuery.eq('party_type', f.partyType)
  if (f.direction) countQuery = countQuery.eq('direction', f.direction)
  if (f.propertyId) countQuery = countQuery.eq('property_id', f.propertyId)
  const { count, error: countError } = await countQuery
  if (countError) throw countError
  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, params.page ?? 1), pageCount)
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  let query = supabase.from('invoices').select('*').eq('workspace_id', workspaceId)
  if (f.status) query = query.eq('status', f.status)
  if (f.partyType) query = query.eq('party_type', f.partyType)
  if (f.direction) query = query.eq('direction', f.direction)
  if (f.propertyId) query = query.eq('property_id', f.propertyId)
  const { data, error } = await query.order('created_at', { ascending: false }).range(from, to)
  if (error) throw error

  return { rows: (data ?? []) as Invoice[], total, page, pageSize, pageCount }
}

export type CreateInvoiceLineInput = {
  description: string
  quantity: number
  unitAmount: number
  sortOrder?: number
}

export type CreateInvoiceInput = {
  workspaceId: string
  createdByUserId: string
  partyType: InvoicePartyType
  partyName: string
  direction: InvoiceDirection
  currency: string
  taxRate: number
  issueDate: string
  dueDate?: string | null
  recipientEmail?: string | null
  notes?: string | null
  propertyId?: string | null
  unitId?: string | null
  tenancyId?: string | null
  vendorId?: string | null
  ticketId?: string | null
  lines: CreateInvoiceLineInput[]
}

// The next sequence for a workspace = existing invoice count + 1. Combined with the retry
// below and the invoices_number_workspace_unique constraint, this is safe against the rare
// concurrent-create collision without a DB sequence.
async function invoiceCount(supabase: SupabaseClient, workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('invoices').select('id').eq('workspace_id', workspaceId)
  if (error) throw error
  return data?.length ?? 0
}

/**
 * Create an invoice header + its lines. Allocates INV-<year>-#### app-side and retries on
 * the unique-violation race (Postgres 23505) with a bumped sequence, so two concurrent
 * creates can't collide on a number. A new invoice is born DRAFT.
 */
export async function createInvoice(
  supabase: SupabaseClient,
  input: CreateInvoiceInput,
): Promise<Invoice> {
  const year = new Date().getUTCFullYear()
  const base = await invoiceCount(supabase, input.workspaceId)

  let created: Invoice | null = null
  for (let attempt = 0; attempt < 4 && !created; attempt++) {
    const invoiceNumber = formatInvoiceNumber(base + 1 + attempt, year)
    const { data, error } = await supabase
      .from('invoices')
      .insert({
        workspace_id: input.workspaceId,
        invoice_number: invoiceNumber,
        party_type: input.partyType,
        party_name: input.partyName,
        direction: input.direction,
        status: 'DRAFT',
        property_id: input.propertyId ?? null,
        unit_id: input.unitId ?? null,
        tenancy_id: input.tenancyId ?? null,
        vendor_id: input.vendorId ?? null,
        ticket_id: input.ticketId ?? null,
        currency: input.currency,
        tax_rate: input.taxRate,
        issue_date: input.issueDate,
        due_date: input.dueDate ?? null,
        recipient_email: input.recipientEmail ?? null,
        notes: input.notes ?? null,
        created_by_user_id: input.createdByUserId,
      })
      .select()
      .single()
    if (!error) {
      created = data as Invoice
      break
    }
    // 23505 = unique_violation (another create grabbed this number). Retry with the next.
    if ((error as { code?: string }).code !== '23505') throw error
  }
  if (!created) throw new Error('Could not allocate an invoice number; please retry.')

  await insertLines(supabase, input.workspaceId, created.id, input.lines)
  return created
}

async function insertLines(
  supabase: SupabaseClient,
  workspaceId: string,
  invoiceId: string,
  lines: CreateInvoiceLineInput[],
): Promise<void> {
  if (lines.length === 0) return
  const rows = lines.map((l, i) => ({
    workspace_id: workspaceId,
    invoice_id: invoiceId,
    description: l.description,
    quantity: l.quantity,
    unit_amount: l.unitAmount, // amount is a generated column — never set here.
    sort_order: l.sortOrder ?? i,
  }))
  const { error } = await supabase.from('invoice_line_items').insert(rows)
  if (error) throw error
}

export type UpdateInvoiceInput = {
  partyType?: InvoicePartyType
  partyName?: string
  direction?: InvoiceDirection
  currency?: string
  taxRate?: number
  issueDate?: string
  dueDate?: string | null
  recipientEmail?: string | null
  notes?: string | null
  propertyId?: string | null
  unitId?: string | null
  tenancyId?: string | null
  vendorId?: string | null
  ticketId?: string | null
}

// Edit the header. undefined-skip / null-through, snake_case mapping. Status is a separate
// action (setInvoiceStatus); line edits are replaceInvoiceLines.
export async function updateInvoice(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  input: UpdateInvoiceInput,
): Promise<Invoice> {
  const payload: Record<string, unknown> = {}
  if (input.partyType !== undefined) payload.party_type = input.partyType
  if (input.partyName !== undefined) payload.party_name = input.partyName
  if (input.direction !== undefined) payload.direction = input.direction
  if (input.currency !== undefined) payload.currency = input.currency
  if (input.taxRate !== undefined) payload.tax_rate = input.taxRate
  if (input.issueDate !== undefined) payload.issue_date = input.issueDate
  if (input.dueDate !== undefined) payload.due_date = input.dueDate
  if (input.recipientEmail !== undefined) payload.recipient_email = input.recipientEmail
  if (input.notes !== undefined) payload.notes = input.notes
  if (input.propertyId !== undefined) payload.property_id = input.propertyId
  if (input.unitId !== undefined) payload.unit_id = input.unitId
  if (input.tenancyId !== undefined) payload.tenancy_id = input.tenancyId
  if (input.vendorId !== undefined) payload.vendor_id = input.vendorId
  if (input.ticketId !== undefined) payload.ticket_id = input.ticketId
  const { data, error } = await supabase
    .from('invoices').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Invoice
}

// Replace an invoice's lines wholesale (the edit-lines flow): delete the existing lines,
// insert the new set. Line-item DELETE is finance-gated (0019). Not atomic across the two
// statements — acceptable for a single-editor MVP; a stored proc is the hardening path.
export async function replaceInvoiceLines(
  supabase: SupabaseClient,
  workspaceId: string,
  invoiceId: string,
  lines: CreateInvoiceLineInput[],
): Promise<void> {
  const { error: delError } = await supabase
    .from('invoice_line_items').delete().eq('workspace_id', workspaceId).eq('invoice_id', invoiceId)
  if (delError) throw delError
  await insertLines(supabase, workspaceId, invoiceId, lines)
}

// Set the status. Stamps paid_at when entering PAID (and clears it when leaving PAID), so
// the paid timestamp always reflects the current PAID state.
export async function setInvoiceStatus(
  supabase: SupabaseClient,
  workspaceId: string,
  id: string,
  status: InvoiceStatus,
): Promise<Invoice> {
  const payload: Record<string, unknown> = {
    status,
    paid_at: status === 'PAID' ? new Date().toISOString() : null,
  }
  const { data, error } = await supabase
    .from('invoices').update(payload).eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw error
  return data as Invoice
}
