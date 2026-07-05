'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { redirectWithError } from '@/lib/redirect-with-error'
import { z } from 'zod'
import { AUTH_CALLBACK_URL } from '@/lib/urls'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  // SUPER_ADMIN deliberately excluded: platform-internal role, never workspace-assignable.
  role: z.enum(['OPERATOR', 'ACCOUNTANT', 'OWNER']),
})

export async function inviteUser(formData: FormData) {
  const admin = await requirePermission('users:invite')

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'OPERATOR',
  })

  if (!parsed.success) {
    redirectWithError('/settings/users', parsed.error.issues[0].message)
  }

  const { email, role } = parsed.data

  const admin_client = createServiceClient()
  const { data, error } = await admin_client.auth.admin.inviteUserByEmail(email, {
    redirectTo: AUTH_CALLBACK_URL,
  })

  if (error) throw error

  // handle_new_user already created a profile row for the invited user; attach it to
  // this workspace with the chosen role.
  const { error: attachError } = await admin_client
    .from('profiles')
    .update({ workspace_id: admin.workspaceId, role })
    .eq('id', data.user.id)
    .select('id')
    .single()

  if (attachError) throw attachError

  revalidatePath('/settings/users')
}

export async function setUserActive(formData: FormData) {
  const admin = await requirePermission('users:manage')
  const userId = String(formData.get('userId') ?? '')
  const isActive = formData.get('isActive') === 'true'

  if (userId === admin.id) {
    redirectWithError('/settings/users', 'You cannot deactivate your own account.')
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .eq('workspace_id', admin.workspaceId)
    .select('id')
    .single()

  // .single() errors on 0 matched rows too, so a foreign-workspace or unknown
  // userId surfaces as an error instead of silently "succeeding" in the UI.
  if (error) {
    redirectWithError('/settings/users', 'Could not update that user.')
  }

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
