'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { incomeFormSchema, expenseFormSchema } from '@/lib/validation/finance'
import { createIncomeRecord, createExpenseRecord } from '@/lib/data/finance'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getTicket } from '@/lib/data/tickets'

function parseIncomeForm(formData: FormData) {
  return incomeFormSchema.safeParse({
    amount: formData.get('amount'),
    category: formData.get('category'),
    periodStart: formData.get('periodStart'),
    // `|| null` maps an empty period_end to null (point-in-time booking).
    periodEnd: (formData.get('periodEnd') as string | null) || null,
    // `|| null` maps an unselected property/unit ("") to null (workspace-level booking).
    propertyId: (formData.get('propertyId') as string | null) || null,
    unitId: (formData.get('unitId') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
  })
}

function parseExpenseForm(formData: FormData) {
  return expenseFormSchema.safeParse({
    amount: formData.get('amount'),
    category: formData.get('category'),
    incurredOn: formData.get('incurredOn'),
    propertyId: (formData.get('propertyId') as string | null) || null,
    unitId: (formData.get('unitId') as string | null) || null,
    ticketId: (formData.get('ticketId') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
  })
}

// Friendly composite-ownership check: each of propertyId / unitId / ticketId is an
// OPTIONAL attribution. Before we insert, confirm any non-null attribution belongs to the
// caller's workspace (the getX loaders are workspace-scoped, so an id from another
// workspace returns null and we redirect with a readable error) — mirrors
// createTenancyAction's getUnit check. The DB composite FKs (0017) are the un-bypassable
// backstop; these checks just turn a raw FK error into a friendly message.

// Managers who keep the books add finance rows. We gate on 'finance:write' — held by
// SUPER_ADMIN / OWNER / ACCOUNTANT (NOT OPERATOR — the finance role inversion). RLS
// (income/expense INSERT is can_manage_finance()-gated in 0017) is the real boundary.
export async function createIncomeAction(formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const parsed = parseIncomeForm(formData)
  if (!parsed.success) {
    redirectWithError('/finance', parsed.error.issues[0].message)
  }

  const supabase = await createClient()

  if (parsed.data.propertyId) {
    const property = await getProperty(supabase, user.workspaceId, parsed.data.propertyId)
    if (!property) {
      redirectWithError('/finance', 'Selected property was not found in your workspace.')
    }
  }
  if (parsed.data.unitId) {
    const unit = await getUnit(supabase, user.workspaceId, parsed.data.unitId)
    if (!unit) {
      redirectWithError('/finance', 'Selected unit was not found in your workspace.')
    }
  }

  try {
    await createIncomeRecord(supabase, {
      workspaceId: user.workspaceId,
      createdByUserId: user.id,
      amount: parsed.data.amount,
      category: parsed.data.category,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd ?? null,
      propertyId: parsed.data.propertyId ?? null,
      unitId: parsed.data.unitId ?? null,
      notes: parsed.data.notes ?? null,
    })
  } catch (e) {
    redirectWithError('/finance', e instanceof Error ? e.message : 'Could not add income.')
  }
  revalidatePath('/finance')
}

export async function createExpenseAction(formData: FormData): Promise<void> {
  const user = await requirePermission('finance:write')
  const parsed = parseExpenseForm(formData)
  if (!parsed.success) {
    redirectWithError('/finance', parsed.error.issues[0].message)
  }

  const supabase = await createClient()

  if (parsed.data.propertyId) {
    const property = await getProperty(supabase, user.workspaceId, parsed.data.propertyId)
    if (!property) {
      redirectWithError('/finance', 'Selected property was not found in your workspace.')
    }
  }
  if (parsed.data.unitId) {
    const unit = await getUnit(supabase, user.workspaceId, parsed.data.unitId)
    if (!unit) {
      redirectWithError('/finance', 'Selected unit was not found in your workspace.')
    }
  }
  if (parsed.data.ticketId) {
    const ticket = await getTicket(supabase, user.workspaceId, parsed.data.ticketId)
    if (!ticket) {
      redirectWithError('/finance', 'Selected ticket was not found in your workspace.')
    }
  }

  try {
    await createExpenseRecord(supabase, {
      workspaceId: user.workspaceId,
      createdByUserId: user.id,
      amount: parsed.data.amount,
      category: parsed.data.category,
      incurredOn: parsed.data.incurredOn,
      propertyId: parsed.data.propertyId ?? null,
      unitId: parsed.data.unitId ?? null,
      ticketId: parsed.data.ticketId ?? null,
      notes: parsed.data.notes ?? null,
    })
  } catch (e) {
    redirectWithError('/finance', e instanceof Error ? e.message : 'Could not add expense.')
  }
  revalidatePath('/finance')
}
