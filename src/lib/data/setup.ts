import type { SupabaseClient } from '@supabase/supabase-js'

// Workspace setup progress for the dashboard's "Finish setting up" checklist. The
// zero-property dashboard shows the full onboarding empty state; this covers the gap
// AFTER the first property exists, when the old dashboard flipped straight to six
// zero-count ticket cards with no pointer to units → tenancies → residents.
//
// Three parallel head-only counts (no rows shipped) — they ride in the dashboard's
// existing Promise.all, so they add concurrency, not serial time. RLS scopes each to
// the caller's workspace; the explicit .eq keeps intent readable and the query
// index-aligned.
export type SetupProgress = {
  units: number
  tenancies: number
  invitedResidents: number
}

export async function getSetupProgress(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<SetupProgress> {
  const [units, tenancies, invited] = await Promise.all([
    supabase
      .from('units')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
    supabase
      .from('tenancies')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId),
    // A resident counts as invited once their person record is linked to an auth
    // account (set by the portal-invite flow).
    supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .not('auth_user_id', 'is', null),
  ])
  return {
    units: units.count ?? 0,
    tenancies: tenancies.count ?? 0,
    invitedResidents: invited.count ?? 0,
  }
}
