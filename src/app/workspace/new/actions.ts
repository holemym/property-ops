'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { workspaceFormSchema } from '@/lib/validation/workspace'
import { createWorkspaceAndAssignOwner } from '@/lib/data/workspaces'
import { redirectWithError } from '@/lib/redirect-with-error'

export async function createWorkspace(formData: FormData) {
  const user = await requireUser()
  if (user.workspaceId) redirect('/dashboard')

  const parsed = workspaceFormSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency') || 'EUR',
    language: formData.get('language') || 'en',
  })

  if (!parsed.success) {
    redirectWithError('/workspace/new', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  try {
    await createWorkspaceAndAssignOwner(supabase, parsed.data)
  } catch (e) {
    // The RPC raises 'User already belongs to a workspace' on double-submit; surface
    // it as a friendly banner instead of a generic error boundary.
    // NOTE: the success redirect below stays OUTSIDE this try — redirect() throws
    // NEXT_REDIRECT internally, which this catch must never swallow.
    redirectWithError('/workspace/new', e instanceof Error ? e.message : 'Could not create workspace.')
  }

  redirect('/dashboard')
}
