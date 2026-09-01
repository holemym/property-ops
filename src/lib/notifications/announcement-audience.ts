import type { SupabaseClient } from '@supabase/supabase-js'
import type { Role, Tenancy } from '@/types/domain'
import type { Tenant } from '@/lib/data/tenants'
import type { Unit } from '@/lib/data/units'
import { isTenantRole } from '@/lib/auth/permissions'
import { listTenancies } from '@/lib/data/tenancies'
import { listTenants } from '@/lib/data/tenants'
import { listUnits } from '@/lib/data/units'

// ---------------------------------------------------------------------------
// announcement-audience — WHO gets an ANNOUNCEMENT_PUBLISHED notification.
//
// Mirrors the split in notify-inapp.ts: a PURE resolver (the unit-testable
// core, mirroring resolveStatusChangedRecipients & co) plus a thin fetch
// wrapper that assembles its inputs from the existing data helpers
// (listTenancies / listTenants / listUnits — reused, not re-derived).
//
// The audience deliberately matches what tenant_can_read_announcement
// (migration 0030) grants READ access to, so nobody is ever pinged about a
// notice they cannot open:
//   * workspace-wide (property_id null)  -> every ACTIVE TENANT/GUEST profile
//     in the workspace;
//   * property-targeted                  -> tenants holding an ACTIVE tenancy
//     (start_date <= today <= end_date, end null = open-ended) in a unit of
//     that property, reached via tenancies.tenant_id -> tenants.auth_user_id
//     (the 0029 portal-link chain) — still intersected with the active
//     TENANT/GUEST profile set, because 0030's helper also gates on role +
//     is_active.
// An unlinked tenancy (tenant_id null) or an un-invited tenant (auth_user_id
// null) simply contributes no recipient — same fail-closed shape as the RLS.
// ---------------------------------------------------------------------------

export type AudienceProfile = { id: string; role: Role; is_active: boolean }

/** Local YYYY-MM-DD, comparable lexicographically with the DB's date strings. */
function todayISO(): string {
  const now = new Date()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

/**
 * Pure audience resolution. Returns recipient PROFILE ids (auth user ids),
 * deduped, in the incoming profile order (stable). No I/O.
 */
export function resolveAnnouncementAudience(input: {
  propertyId: string | null
  profiles: AudienceProfile[]
  tenants: Pick<Tenant, 'id' | 'auth_user_id'>[]
  tenancies: Pick<Tenancy, 'tenant_id' | 'unit_id' | 'start_date' | 'end_date'>[]
  units: Pick<Unit, 'id' | 'property_id'>[]
  /** YYYY-MM-DD; injectable for tests, defaults to today. */
  today?: string
}): string[] {
  const residents = input.profiles.filter((p) => p.is_active && isTenantRole(p.role))
  if (!input.propertyId) return residents.map((p) => p.id)

  const today = input.today ?? todayISO()
  const unitIds = new Set(
    input.units.filter((u) => u.property_id === input.propertyId).map((u) => u.id)
  )
  const activeTenantIds = new Set(
    input.tenancies
      .filter(
        (t) =>
          t.tenant_id !== null &&
          unitIds.has(t.unit_id) &&
          t.start_date <= today &&
          (t.end_date === null || t.end_date >= today)
      )
      .map((t) => t.tenant_id as string)
  )
  const targetedUserIds = new Set(
    input.tenants
      .filter((t) => activeTenantIds.has(t.id) && t.auth_user_id !== null)
      .map((t) => t.auth_user_id as string)
  )
  return residents.filter((p) => targetedUserIds.has(p.id)).map((p) => p.id)
}

/**
 * Assemble the resolver's inputs for one workspace + scope. Runs IN-REQUEST on
 * the caller's own RLS-bound client (a manager can read profiles, tenancies,
 * tenants, and units under the existing policies — no service client needed
 * for the READ side), so publishAnnouncementAction can branch its redirect on
 * an empty audience before the response is sent. The property-scoped rosters
 * are only fetched when the announcement is actually property-targeted.
 */
export async function fetchAnnouncementAudience(
  supabase: SupabaseClient,
  workspaceId: string,
  propertyId: string | null
): Promise<string[]> {
  // Same partial-column profile read shape as listWorkspaceOperators
  // (src/lib/data/tickets.ts) — role filtering stays in JS (portable across the
  // in-memory test client and PostgREST alike, via the pure resolver above).
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
  if (error) throw error
  const profiles = data as unknown as AudienceProfile[]

  if (!propertyId) {
    return resolveAnnouncementAudience({ propertyId, profiles, tenants: [], tenancies: [], units: [] })
  }

  const [tenancies, tenants, units] = await Promise.all([
    listTenancies(supabase, workspaceId),
    listTenants(supabase, workspaceId),
    listUnits(supabase, workspaceId),
  ])
  return resolveAnnouncementAudience({ propertyId, profiles, tenants, tenancies, units })
}
