import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasLiveCreds, setupTwoWorkspaces, teardown, type RlsFixture } from './helpers'

// Transcribes the migration 0017 finance smoke tests (the load-bearing subset):
//   #2 accountant can INSERT income + expense (the ACCOUNTANT's FIRST write permission);
//   #3 THE ROLE INVERSION — operator CAN SELECT finance rows (cost visibility) but is
//      REJECTED on INSERT (can_manage_finance() excludes OPERATOR);
//   #4 tenant SELECT returns ZERO rows (role-gated, not open-select);
//   #5 cross-workspace SELECT returns ZERO of workspace A's rows (tenant isolation).
// Skips wholesale without live RLS_TEST_* creds (hasLiveCreds()).
describe.skipIf(!hasLiveCreds())('RLS: finance income + expense', () => {
  let f: RlsFixture

  beforeAll(async () => {
    f = await setupTwoWorkspaces()
  })
  afterAll(async () => {
    await teardown(f)
  })

  // #2 — the accountant owns the books. can_manage_finance() INCLUDES ACCOUNTANT, so both
  // the income WITH CHECK and the expense WITH CHECK pass. This is the accountant's first
  // write permission across the whole schema.
  it('accountant CAN INSERT an income record', async () => {
    const { data, error } = await f.clients.aAccountant
      .from('income_records')
      .insert({
        workspace_id: f.workspaceA,
        amount: 1200,
        category: 'RENT',
        period_start: '2026-07-01',
        created_by_user_id: f.users.aAccountant.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('accountant CAN INSERT an expense record', async () => {
    const { data, error } = await f.clients.aAccountant
      .from('expense_records')
      .insert({
        workspace_id: f.workspaceA,
        amount: 300,
        category: 'MAINTENANCE',
        incurred_on: '2026-07-03',
        created_by_user_id: f.users.aAccountant.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  // #3 — THE ROLE INVERSION. Operator gets cost visibility on SELECT...
  it('operator CAN SELECT finance rows (cost visibility)', async () => {
    const { data: income, error: incErr } = await f.clients.aOperator
      .from('income_records')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(incErr).toBeNull()
    expect((income ?? []).length).toBeGreaterThan(0)

    const { data: expense, error: expErr } = await f.clients.aOperator
      .from('expense_records')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(expErr).toBeNull()
    expect((expense ?? []).length).toBeGreaterThan(0)
  })

  // ...but is REJECTED on INSERT (can_manage_finance() EXCLUDES OPERATOR). This is the
  // single most important assertion — the OPPOSITE of every prior domain table.
  it('operator INSERT of an income record is REJECTED (role inversion)', async () => {
    const { data, error } = await f.clients.aOperator
      .from('income_records')
      .insert({
        workspace_id: f.workspaceA,
        amount: 999,
        category: 'RENT',
        period_start: '2026-07-01',
        created_by_user_id: f.users.aOperator.id,
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  it('operator INSERT of an expense record is REJECTED (role inversion)', async () => {
    const { data, error } = await f.clients.aOperator
      .from('expense_records')
      .insert({
        workspace_id: f.workspaceA,
        amount: 999,
        category: 'UTILITIES',
        incurred_on: '2026-07-01',
        created_by_user_id: f.users.aOperator.id,
      })
      .select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)
  })

  // #4 — tenants are not finance-facing: role-gated SELECT returns zero rows.
  it('tenant SELECT returns ZERO finance rows', async () => {
    const { data: income } = await f.clients.aTenant1
      .from('income_records')
      .select('id')
    expect(income ?? []).toHaveLength(0)

    const { data: expense } = await f.clients.aTenant1
      .from('expense_records')
      .select('id')
    expect(expense ?? []).toHaveLength(0)
  })

  // #5 — cross-workspace isolation: workspace B's owner sees ZERO of A's finance rows.
  it('cross-workspace SELECT returns ZERO of workspace A finance rows', async () => {
    const { data: income } = await f.clients.bOwner
      .from('income_records')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(income ?? []).toHaveLength(0)

    const { data: expense } = await f.clients.bOwner
      .from('expense_records')
      .select('id')
      .eq('workspace_id', f.workspaceA)
    expect(expense ?? []).toHaveLength(0)
  })
})
