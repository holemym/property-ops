'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/auth/session'
import { workspaceFormSchema } from '@/lib/validation/workspace'
import { createWorkspaceAndAssignOwner } from '@/lib/data/workspaces'

export async function createWorkspace(formData: FormData) {
  const user = await requireUser()

  const parsed = workspaceFormSchema.safeParse({
    name: formData.get('name'),
    currency: formData.get('currency') || 'EUR',
    language: formData.get('language') || 'en',
  })

  if (!parsed.success) {
    redirect(`/workspace/new?error=${encodeURIComponent(parsed.error.issues[0].message)}`)
  }

  const supabase = await createClient()
  await createWorkspaceAndAssignOwner(supabase, parsed.data)

  redirect('/dashboard')
}
