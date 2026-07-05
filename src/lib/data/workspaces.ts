import type { SupabaseClient } from '@supabase/supabase-js'

export type CreateWorkspaceInput = {
  name: string
  currency: string
  language: string
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
