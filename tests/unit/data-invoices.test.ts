import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import { listTenantCharges } from '@/lib/data/invoices'

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
