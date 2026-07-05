import { describe, it, expect, beforeEach } from 'vitest'
import { createFakeSupabaseClient } from '../helpers/fake-supabase'
import {
  listTickets,
  getTicket,
  createTicket,
  updateTicketStatus,
  assignTicket,
  getWorkspaceProfile,
  listWorkspaceOperators,
  countTicketsByStatus,
} from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'

const WS_A = 'workspace-a'
const WS_B = 'workspace-b'
const PROP_1 = 'prop-1'
const PROP_2 = 'prop-2'
const OP_1 = 'operator-1'

function seed() {
  return createFakeSupabaseClient({
    tickets: [
      { id: 't-1', workspace_id: WS_A, property_id: PROP_1, unit_id: null, created_by_user_id: 'tenant-1', title: 'Leaking tap', description: 'drip', category: 'PLUMBING', priority: 'HIGH', status: 'NEW', assigned_operator_id: null, assigned_vendor_id: null, created_at: '2026-01-01T00:00:00Z' },
      { id: 't-2', workspace_id: WS_A, property_id: PROP_2, unit_id: null, created_by_user_id: 'tenant-2', title: 'No heating', description: 'cold', category: 'HEATING', priority: 'NORMAL', status: 'TRIAGE', assigned_operator_id: OP_1, assigned_vendor_id: null, created_at: '2026-01-02T00:00:00Z' },
      { id: 't-3', workspace_id: WS_A, property_id: PROP_1, unit_id: null, created_by_user_id: 'tenant-3', title: 'Broken window', description: 'cracked', category: 'DAMAGE', priority: 'HIGH', status: 'IN_PROGRESS', assigned_operator_id: OP_1, assigned_vendor_id: null, created_at: '2026-01-03T00:00:00Z' },
      { id: 't-b', workspace_id: WS_B, property_id: 'prop-other', unit_id: null, created_by_user_id: 'tenant-x', title: 'Other WS ticket', description: 'x', category: 'OTHER', priority: 'LOW', status: 'NEW', assigned_operator_id: null, assigned_vendor_id: null, created_at: '2026-01-04T00:00:00Z' },
    ],
    profiles: [
      { id: OP_1, workspace_id: WS_A, full_name: 'Olly Operator', role: 'OPERATOR' },
      { id: 'op-b', workspace_id: WS_B, full_name: 'Foreign Op', role: 'OPERATOR' },
    ],
  })
}

describe('tickets data access', () => {
  let client: ReturnType<typeof createFakeSupabaseClient>
  beforeEach(() => { client = seed() })

  it('only lists tickets for the given workspace', async () => {
    const result = await listTickets(client, WS_A)
    expect(result).toHaveLength(3)
    expect(result.map((t) => t.title)).not.toContain('Other WS ticket')
  })

  it('orders by created_at descending', async () => {
    const result = await listTickets(client, WS_A)
    expect(result[0].id).toBe('t-3')
    expect(result[2].id).toBe('t-1')
  })

  it('filters by status', async () => {
    const result = await listTickets(client, WS_A, { status: 'TRIAGE' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t-2')
  })

  it('filters by priority', async () => {
    const result = await listTickets(client, WS_A, { priority: 'HIGH' })
    expect(result.map((t) => t.id).sort()).toEqual(['t-1', 't-3'])
  })

  it('filters by property', async () => {
    const result = await listTickets(client, WS_A, { propertyId: PROP_1 })
    expect(result.map((t) => t.id).sort()).toEqual(['t-1', 't-3'])
  })

  it('filters by assigned operator', async () => {
    const result = await listTickets(client, WS_A, { assignedOperatorId: OP_1 })
    expect(result.map((t) => t.id).sort()).toEqual(['t-2', 't-3'])
  })

  it('searches by title', async () => {
    const result = await listTickets(client, WS_A, { search: 'tap' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('t-1')
  })

  it('returns null for a ticket in another workspace', async () => {
    const result = await getTicket(client, WS_A, 't-b')
    expect(result).toBeNull()
  })

  it('gets a ticket scoped to the workspace', async () => {
    const result = await getTicket(client, WS_A, 't-1')
    expect(result?.title).toBe('Leaking tap')
  })

  it('creates a ticket forcing status NEW and scoping the workspace', async () => {
    const created = await createTicket(client, {
      workspaceId: WS_A,
      propertyId: PROP_1,
      createdByUserId: 'tenant-1',
      title: 'New request',
      description: 'please fix',
      category: 'ELECTRICAL',
      priority: 'URGENT',
    })
    expect(created.status).toBe('NEW')
    expect(created.workspace_id).toBe(WS_A)
    expect(created.property_id).toBe(PROP_1)
    expect(created.unit_id).toBeNull()
  })

  it('updates status on a legal transition and stamps resolved_at on RESOLVED', async () => {
    const updated = await updateTicketStatus(client, WS_A, 't-3', 'RESOLVED', 'IN_PROGRESS')
    expect(updated.status).toBe('RESOLVED')
    expect(updated.resolved_at).not.toBeNull()
    expect(updated.resolved_at).toBeTruthy()
  })

  it('stamps closed_at when transitioning to CLOSED', async () => {
    // t-3 seeds as IN_PROGRESS; walk the real chain to RESOLVED then CLOSED so the
    // compare-and-swap's `.eq('status', currentStatus)` predicate matches at each step
    // (rather than relying on prior-test state).
    await updateTicketStatus(client, WS_A, 't-3', 'RESOLVED', 'IN_PROGRESS')
    const updated = await updateTicketStatus(client, WS_A, 't-3', 'CLOSED', 'RESOLVED')
    expect(updated.status).toBe('CLOSED')
    expect(updated.closed_at).toBeTruthy()
  })

  it('rejects a stale transition when the DB status no longer matches (compare-and-swap)', async () => {
    // t-3 is IN_PROGRESS; a caller who thinks it is still TRIAGE (stale view) supplies a
    // legal-from-TRIAGE next status, but the CAS predicate matches zero rows → error.
    await expect(
      updateTicketStatus(client, WS_A, 't-3', 'ASSIGNED', 'TRIAGE')
    ).rejects.toThrow()
  })

  it('throws on an illegal status transition (NEW -> CLOSED)', async () => {
    await expect(updateTicketStatus(client, WS_A, 't-1', 'CLOSED', 'NEW')).rejects.toThrow()
  })

  it('assigns an operator', async () => {
    const updated = await assignTicket(client, WS_A, 't-1', { assignedOperatorId: OP_1 })
    expect(updated.assigned_operator_id).toBe(OP_1)
  })

  it('unassigns an operator via null', async () => {
    const updated = await assignTicket(client, WS_A, 't-2', { assignedOperatorId: null })
    expect(updated.assigned_operator_id).toBeNull()
  })

  it('does not change status when assigning', async () => {
    const updated = await assignTicket(client, WS_A, 't-1', { assignedOperatorId: OP_1 })
    expect(updated.status).toBe('NEW')
  })

  it('getWorkspaceProfile returns the profile for an in-workspace user', async () => {
    const profile = await getWorkspaceProfile(client, WS_A, OP_1)
    expect(profile?.id).toBe(OP_1)
    expect(profile?.full_name).toBe('Olly Operator')
  })

  it('getWorkspaceProfile returns null for a foreign-workspace user', async () => {
    const profile = await getWorkspaceProfile(client, WS_A, 'op-b')
    expect(profile).toBeNull()
  })

  it('listWorkspaceOperators returns only active manager-role profiles in the workspace', async () => {
    const opsClient = createFakeSupabaseClient({
      profiles: [
        { id: 'owner-1', workspace_id: WS_A, full_name: 'Ownie Owner', role: 'OWNER', is_active: true },
        { id: 'op-a', workspace_id: WS_A, full_name: 'Ally Operator', role: 'OPERATOR', is_active: true },
        { id: 'sa-1', workspace_id: WS_A, full_name: 'Sam Admin', role: 'SUPER_ADMIN', is_active: true },
        // Excluded: accountant/tenant roles are never assignable operators.
        { id: 'acct-1', workspace_id: WS_A, full_name: 'Andy Accountant', role: 'ACCOUNTANT', is_active: true },
        { id: 'ten-1', workspace_id: WS_A, full_name: 'Tina Tenant', role: 'TENANT', is_active: true },
        // Excluded: inactive operator.
        { id: 'op-inactive', workspace_id: WS_A, full_name: 'Ida Inactive', role: 'OPERATOR', is_active: false },
        // Excluded: operator in another workspace.
        { id: 'op-foreign', workspace_id: WS_B, full_name: 'Fred Foreign', role: 'OPERATOR', is_active: true },
      ],
    })
    const operators = await listWorkspaceOperators(opsClient, WS_A)
    expect(operators.map((o) => o.id).sort()).toEqual(['op-a', 'owner-1', 'sa-1'])
  })

  it('countTicketsByStatus tallies statuses for the workspace', async () => {
    const counts = await countTicketsByStatus(client, WS_A)
    expect(counts.NEW).toBe(1)
    expect(counts.TRIAGE).toBe(1)
    expect(counts.IN_PROGRESS).toBe(1)
  })

  // appendTicketEvent is a thin RPC wrapper over the service-role-only
  // log_ticket_event funnel; the one thing worth pinning is the p_* param mapping.
  it('appendTicketEvent calls log_ticket_event with the p_* param mapping', async () => {
    await appendTicketEvent(client, {
      workspaceId: WS_A,
      ticketId: 't-1',
      eventType: 'STATUS_CHANGED',
      actorUserId: OP_1,
      oldValueJson: { status: 'NEW' },
      newValueJson: { status: 'TRIAGE' },
    })
    const call = (client as unknown as { _rpcCalls: Array<{ name: string; params: Record<string, unknown> }> })._rpcCalls[0]
    expect(call.name).toBe('log_ticket_event')
    expect(call.params.p_workspace_id).toBe(WS_A)
    expect(call.params.p_ticket_id).toBe('t-1')
    expect(call.params.p_event_type).toBe('STATUS_CHANGED')
    expect(call.params.p_actor_user_id).toBe(OP_1)
    expect(call.params.p_actor_type).toBe('USER')
    expect(call.params.p_new_value_json).toEqual({ status: 'TRIAGE' })
  })
})
