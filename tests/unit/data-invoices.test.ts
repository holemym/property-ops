import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listTenantCharges, listInvoices, listInvoicesPage, createInvoice } from '@/lib/data/invoices'

const WS_A = 'workspace-a'
const WS_B = 'workspace-b'

function invoice(overrides: Record<string, unknown>) {
  return {
    workspace_id: WS_A,
    invoice_number: 'INV-2026-0001',
    party_type: 'TENANT',
    party_name: 'Jane Tenant',
    direction: 'OUTBOUND',
    status: 'SENT',
    currency: 'EUR',
    tax_rate: 0,
    issue_date: '2026-01-01',
    due_date: null,
    created_by_user_id: 'u1',
    ...overrides,
  }
}

describe('listTenantCharges', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>

  beforeEach(() => {
    client = createFakeSupabaseClient({
      invoices: [
        invoice({ id: 'i-sent', issue_date: '2026-03-01', status: 'SENT' }),
        invoice({ id: 'i-paid', issue_date: '2026-02-01', status: 'PAID' }),
        // A DRAFT must never surface as a tenant's charge, even in the data layer's
        // own belt-and-suspenders filter (defense in depth alongside the RLS pin).
        invoice({ id: 'i-draft', issue_date: '2026-04-01', status: 'DRAFT' }),
        // An INBOUND (vendor bill) must never surface as "your charge" even if it
        // somehow carried a tenant-looking party_type.
        invoice({ id: 'i-inbound', issue_date: '2026-01-15', status: 'SENT', direction: 'INBOUND' }),
        // Another workspace's invoice must never leak.
        invoice({ id: 'i-other-ws', workspace_id: WS_B, issue_date: '2026-05-01', status: 'SENT' }),
      ],
    })
  })

  it('lists only OUTBOUND, non-DRAFT invoices for the workspace, newest-issued-first', async () => {
    const result = await listTenantCharges(client, WS_A)
    expect(result.map((i) => i.id)).toEqual(['i-sent', 'i-paid'])
  })

  it('excludes DRAFT invoices', async () => {
    const result = await listTenantCharges(client, WS_A)
    expect(result.map((i) => i.id)).not.toContain('i-draft')
  })

  it('excludes INBOUND (vendor bill) invoices', async () => {
    const result = await listTenantCharges(client, WS_A)
    expect(result.map((i) => i.id)).not.toContain('i-inbound')
  })

  it('never leaks another workspace\'s invoices', async () => {
    const result = await listTenantCharges(client, WS_A)
    expect(result.map((i) => i.id)).not.toContain('i-other-ws')
  })
})

describe('overdue quick filter', () => {
  // Far-past / far-future due dates so the predicate's internal "today" can't flake.
  const seed = () =>
    createFakeSupabaseClient({
      invoices: [
        invoice({ id: 'i-sent-due', status: 'SENT', due_date: '2020-01-01' }),
        invoice({ id: 'i-partial-due', status: 'PARTIAL', due_date: '2020-01-01' }),
        // A stored OVERDUE must match the filter too — the word means one thing everywhere.
        invoice({ id: 'i-stored-overdue', status: 'OVERDUE', due_date: '2020-01-01' }),
        invoice({ id: 'i-sent-future', status: 'SENT', due_date: '2999-01-01' }),
        invoice({ id: 'i-paid-due', status: 'PAID', due_date: '2020-01-01' }),
        invoice({ id: 'i-draft-due', status: 'DRAFT', due_date: '2020-01-01' }),
        invoice({ id: 'i-no-due', status: 'SENT', due_date: null }),
      ],
    })

  it('listInvoices matches past-due SENT / PARTIAL / stored-OVERDUE only', async () => {
    const result = await listInvoices(seed(), WS_A, { overdue: true })
    expect(result.map((i) => i.id).sort()).toEqual([
      'i-partial-due',
      'i-sent-due',
      'i-stored-overdue',
    ])
  })

  it('listInvoicesPage applies the same predicate (stored OVERDUE included)', async () => {
    const page = await listInvoicesPage(seed(), WS_A, { filters: { overdue: true } })
    expect(page.total).toBe(3)
    expect(page.rows.map((i) => i.id).sort()).toEqual([
      'i-partial-due',
      'i-sent-due',
      'i-stored-overdue',
    ])
  })
})

describe('createInvoice number allocation', () => {
  it('allocates the next sequence from a head-only exact count', async () => {
    const client = createFakeSupabaseClient({
      invoices: [
        invoice({ id: 'i-1', invoice_number: 'INV-2026-0001' }),
        // Another workspace's invoice must not inflate the sequence.
        invoice({ id: 'i-b', workspace_id: WS_B, invoice_number: 'INV-2026-0009' }),
      ],
    })
    const created = await createInvoice(client, {
      workspaceId: WS_A,
      createdByUserId: 'u1',
      partyType: 'OWNER',
      partyName: 'Jane Owner',
      direction: 'OUTBOUND',
      currency: 'EUR',
      taxRate: 0,
      issueDate: '2026-07-01',
      lines: [{ description: 'Fee', quantity: 1, unitAmount: 100 }],
    })
    const year = new Date().getUTCFullYear()
    expect(created.invoice_number).toBe(`INV-${year}-0002`)
    expect(created.status).toBe('DRAFT')
  })
})
