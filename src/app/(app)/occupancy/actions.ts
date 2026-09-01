'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { tenancyFormSchema } from '@/lib/validation/tenancy'
import {
  createTenancy,
  updateTenancy,
  getTenancy,
  listTenanciesForUnit,
} from '@/lib/data/tenancies'
import { findOverlappingTenancy } from '@/lib/occupancy/overlap'
import { getUnit } from '@/lib/data/units'
import { formatDate } from '@/lib/format-date'
import type { Tenancy } from '@/types/domain'

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

// The dialogs post their host page's own path (a hidden `returnTo` input: '/occupancy'
// on the occupancy page, '/units/<id>' on a unit hub) so error AND success redirects
// land back where the user actually was, instead of teleporting every outcome to
// /occupancy. Server-side shape check: a same-app absolute path only — must start with
// a single '/' ('//host' is a protocol-relative external URL) and carry no query (both
// redirectWithError and the success redirect append their own `?param=`). Anything
// else falls back to /occupancy.
function safeReturnTo(formData: FormData): string {
  const value = formData.get('returnTo')
  return typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('?')
    ? value
    : '/occupancy'
}

// The double-booking error names the conflicting tenant + span so the fix is obvious
// from the toast alone (spans are closed intervals — see findOverlappingTenancy).
function overlapMessage(conflict: Tenancy): string {
  const end = conflict.end_date ? formatDate(conflict.end_date) : 'open-ended'
  return `Overlaps the existing tenancy for ${conflict.tenant_name} (${formatDate(conflict.start_date)} – ${end}).`
}

// Managers add tenancies. We gate on 'units:write' — the same write permission the
// unit-create path uses — so OWNER/OPERATOR/SUPER_ADMIN can add tenancies while
// ACCOUNTANT stays read-only (it holds occupancy:read but not units:write). RLS
// (tenancies INSERT is is_workspace_manager()-gated) is the real boundary.
export async function createTenancyAction(formData: FormData) {
  const user = await requirePermission('units:write')
  const returnTo = safeReturnTo(formData)
  const parsed = parseTenancyForm(formData)
  if (!parsed.success) {
    redirectWithError(returnTo, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  // Friendly composite-ownership check: confirm the unit_id belongs to the caller's
  // workspace before insert (mirrors createUnitAction's getProperty check). getUnit is
  // workspace-scoped, so a unit_id from another workspace returns null here and we
  // redirect with a readable error. The DB composite FK (unit_id, workspace_id) ->
  // units(id, workspace_id) is the un-bypassable backstop.
  const unit = await getUnit(supabase, user.workspaceId, parsed.data.unitId)
  if (!unit) {
    redirectWithError(returnTo, 'Selected unit was not found in your workspace.')
  }

  // Double-booking guard (one extra query): reject a span that intersects any existing
  // tenancy for this unit, naming the conflict. The DB EXCLUDE constraint (separate
  // migration) is the concurrent-writer backstop; this gives the readable error.
  const siblings = await listTenanciesForUnit(supabase, user.workspaceId, parsed.data.unitId)
  const conflict = findOverlappingTenancy(
    siblings,
    parsed.data.startDate,
    parsed.data.endDate ?? null
  )
  if (conflict) {
    redirectWithError(returnTo, overlapMessage(conflict))
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
    redirectWithError(returnTo, e instanceof Error ? e.message : 'Could not add tenancy.')
  }
  // Both surfaces render this unit's tenancies; refresh whichever one wasn't returned to.
  revalidatePath('/occupancy')
  if (returnTo !== '/occupancy') revalidatePath(returnTo)
  // ?tenancy= drives TenancySavedToast on the host page (the ?generated= pattern).
  redirect(`${returnTo}?tenancy=created`)
}

// Edit an existing tenancy — same permission gate, same schema (incl. the end>=start
// refine), same overlap guard as create (excluding the edited row itself). "End
// tenancy" is this action too: the dialog just prefills end date = today. The
// tenancy's unit comes from the DB row, not the form — a tenancy's unit is immutable
// here (same stance as updateUnitAction's property_id note).
export async function updateTenancyAction(id: string, formData: FormData) {
  const user = await requirePermission('units:write')
  const returnTo = safeReturnTo(formData)
  const parsed = parseTenancyForm(formData)
  if (!parsed.success) {
    redirectWithError(returnTo, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  // Friendly ownership check: getTenancy is workspace-scoped, so an id from another
  // workspace (or a deleted row) returns null and we redirect with a readable error.
  // RLS (tenancies UPDATE is is_workspace_manager()-gated) is the real boundary.
  const existing = await getTenancy(supabase, user.workspaceId, id)
  if (!existing) {
    redirectWithError(returnTo, 'Tenancy was not found in your workspace.')
  }

  const siblings = await listTenanciesForUnit(supabase, user.workspaceId, existing.unit_id)
  const conflict = findOverlappingTenancy(
    siblings,
    parsed.data.startDate,
    parsed.data.endDate ?? null,
    id
  )
  if (conflict) {
    redirectWithError(returnTo, overlapMessage(conflict))
  }

  try {
    await updateTenancy(supabase, user.workspaceId, id, {
      tenantId: parsed.data.tenantId ?? null,
      tenantName: parsed.data.tenantName,
      tenantContact: parsed.data.tenantContact ?? null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate ?? null,
      rentAmount: parsed.data.rentAmount ?? null,
      notes: parsed.data.notes ?? null,
    })
  } catch (e) {
    redirectWithError(returnTo, e instanceof Error ? e.message : 'Could not save tenancy.')
  }
  revalidatePath('/occupancy')
  if (returnTo !== '/occupancy') revalidatePath(returnTo)
  redirect(`${returnTo}?tenancy=updated`)
}
