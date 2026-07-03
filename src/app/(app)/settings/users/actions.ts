'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requirePermission } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'

// Service-role client: bypasses RLS and is required for the Auth Admin API
// (inviteUserByEmail). SUPABASE_SERVICE_ROLE_KEY is server-only (never
// NEXT_PUBLIC) and is only ever read inside this 'use server' file, so it is
// never shipped to the client bundle.
function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function inviteUser(formData: FormData) {
  const admin = await requirePermission('users:invite')
  const email = String(formData.get('email') ?? '')
  const role = String(formData.get('role') ?? 'OPERATOR')

  const admin_client = serviceClient()
  const { data, error } = await admin_client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  })

  if (error) throw error

  // handle_new_user already created a profile row for the invited user; attach it to
  // this workspace with the chosen role.
  await admin_client
    .from('profiles')
    .update({ workspace_id: admin.workspaceId, role })
    .eq('id', data.user.id)

  revalidatePath('/settings/users')
}

export async function setUserActive(formData: FormData) {
  const admin = await requirePermission('users:manage')
  const userId = String(formData.get('userId') ?? '')
  const isActive = formData.get('isActive') === 'true'

  const supabase = await createServerClient()
  await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .eq('workspace_id', admin.workspaceId)

  // Future hardening: this flips the app-level is_active flag (enforced by
  // requireUser + RLS), but does NOT revoke the user's live Supabase Auth
  // session. A full deactivation should also call
  // admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' }) via the
  // service-role client to invalidate the JWT at the auth layer. Tracked as a
  // follow-up; the RLS is_active pin (migration 0007) + requireUser check are
  // sufficient to stop a deactivated user reading/writing workspace data or
  // loading app pages in the meantime.

  revalidatePath('/settings/users')
}
