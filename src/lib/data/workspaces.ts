import type { SupabaseClient } from '@supabase/supabase-js'

// Row type for `public.workspaces` (migration 0001, `is_demo`/`demo_reset_at` added
// by 0023). Kept LOCAL to this data file, not src/types/domain.ts — this is a NEW
// row-type addition (no reader existed before Phase 1B needed the contact-block
// workspace name/currency), so it follows the live convention set by tenants
// (0025) / notifications (0026) / auth-events (0028): row types added recently
// live beside their queries, not in domain.ts (see roadmap v2 §2's row-type-
// location rule — enums still always go in domain.ts, but there is no
// workspace-level enum here).
export type Workspace = {
  id: string
  name: string
  legal_name: string | null
  address: string | null
  city: string | null
  country: string | null
  timezone: string
  currency: string
  language: string
  is_active: boolean
  is_demo: boolean
  demo_reset_at: string | null
  created_at: string
  updated_at: string
}

export type CreateWorkspaceInput = {
  name: string
  currency: string
  language: string
}

/**
 * The caller's own workspace (contact-block "who to reach" info for the tenant
 * portal's My Home surface, Phase 1B — name/currency, never anything sensitive).
 * RLS (workspaces_select_own, migration 0002) already scopes this to the caller's
 * OWN workspace id (or a SUPER_ADMIN's platform-wide read override); this layer
 * just shapes the single-row read, mirroring getProperty (src/lib/data/
 * properties.ts:45-54) verbatim: `.eq('id', ...).single()`, null on error/no-row.
 */
export async function getWorkspace(
  supabase: SupabaseClient,
  workspaceId: string
): Promise<Workspace | null> {
  const { data, error } = await supabase
    .from('workspaces').select('*').eq('id', workspaceId).single()
  if (error) return null
  return data as Workspace
}

// Intentional exception to the query-builder pattern used by the rest of lib/data/*
// (see properties.ts, units.ts, vendors.ts): claiming a workspace isn't scoped CRUD --
// there's no workspace_id to filter by yet, and RLS can't safely allow a client-side
// role/workspace_id self-update (see migration 0006). Don't copy this RPC-wrapper shape
// for ordinary CRUD; use an explicit workspaceId parameter + supabase.from(...) instead.
export async function createWorkspaceAndAssignOwner(
  supabase: SupabaseClient,
  input: CreateWorkspaceInput
) {
  const { data: workspace, error } = await supabase.rpc('create_workspace_and_claim_owner', {
    workspace_name: input.name,
    workspace_currency: input.currency,
    workspace_language: input.language,
  })

  if (error) throw error
  return workspace
}
