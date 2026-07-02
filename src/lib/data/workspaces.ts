import type { SupabaseClient } from '@supabase/supabase-js'

export type CreateWorkspaceInput = {
  name: string
  currency: string
  language: string
}

export async function createWorkspaceAndAssignOwner(
  supabase: SupabaseClient,
  userId: string,
  input: CreateWorkspaceInput
) {
  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .insert({ name: input.name, currency: input.currency, language: input.language })
    .select()
    .single()

  if (workspaceError) throw workspaceError

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ workspace_id: workspace.id, role: 'OWNER' })
    .eq('id', userId)

  if (profileError) throw profileError

  return workspace
}
