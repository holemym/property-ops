'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { tenancyFormSchema } from '@/lib/validation/tenancy'
import { createTenancy } from '@/lib/data/tenancies'
import { getUnit } from '@/lib/data/units'

function parseTenancyForm(formData: FormData) {
  return tenancyFormSchema.safeParse({
    unitId: formData.get('unitId'),
    // `|| undefined` maps the select's "no linked person" empty option to undefined,
    // matching tenancyFormSchema's `.nullable().optional()` and the same idiom
    // tickets/actions.ts uses for its optional unitId select.
    tenantId: (formData.get('tenantId') as string | null) || undefined,
    tenantName: formData.get('tenantName'),
    tenantContact: (formData.get('tenantContact') as string | null) || null,
    startDate: formData.get('startDate'),
    // `|| null` maps an empty end_date to null (open-ended tenancy).
    endDate: (formData.get('endDate') as string | null) || null,
    // `|| null` maps both "" and "0" to null; rent is optional and 0 is not meaningful.
    rentAmount: (formData.get('rentAmount') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
  })
}

// Managers add tenancies. We gate on 'units:write' — the same write permission the
// unit-create path uses — so OWNER/OPERATOR/SUPER_ADMIN can add tenancies while
// ACCOUNTANT stays read-only (it holds occupancy:read but not units:write). RLS
// (tenancies INSERT is is_workspace_manager()-gated) is the real boundary.
export async function createTenancyAction(formData: FormData) {
  const user = await requirePermission('units:write')
  const parsed = parseTenancyForm(formData)
  if (!parsed.success) {
    redirectWithError('/occupancy', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  // Friendly composite-ownership check: confirm the unit_id belongs to the caller's
  // workspace before insert (mirrors createUnitAction's getProperty check). getUnit is
  // workspace-scoped, so a unit_id from another workspace returns null here and we
  // redirect with a readable error. The DB composite FK (unit_id, workspace_id) ->
  // units(id, workspace_id) is the un-bypassable backstop.
  const unit = await getUnit(supabase, user.workspaceId, parsed.data.unitId)
  if (!unit) {
    redirectWithError('/occupancy', 'Selected unit was not found in your workspace.')
  }

  try {
    await createTenancy(supabase, {
      workspaceId: user.workspaceId,
      unitId: parsed.data.unitId,
      createdByUserId: user.id,
      tenantId: parsed.data.tenantId ?? null,
      tenantName: parsed.data.tenantName,
      tenantContact: parsed.data.tenantContact ?? null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate ?? null,
      rentAmount: parsed.data.rentAmount ?? null,
      notes: parsed.data.notes ?? null,
    })
  } catch (e) {
    redirectWithError('/occupancy', e instanceof Error ? e.message : 'Could not add tenancy.')
  }
  revalidatePath('/occupancy')
}
