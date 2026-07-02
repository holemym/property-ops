import type { SupabaseClient } from '@supabase/supabase-js'

export type CreateWorkspaceInput = {
  name: string
  currency: string
  language: string
}

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
