'use server'

import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission, requireWorkspace } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { redirectWithError } from '@/lib/redirect-with-error'
import {
  isDemoWorkspace,
  isDemoEnabled,
  canManuallyResetDemo,
  resetDemoWorkspaceData,
  DEMO_USERS_BLOCKED_MESSAGE,
} from '@/lib/demo'
import { z } from 'zod'
import { AUTH_CALLBACK_URL } from '@/lib/urls'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  // SUPER_ADMIN deliberately excluded: platform-internal role, never workspace-assignable.
  role: z.enum(['OPERATOR', 'ACCOUNTANT', 'OWNER']),
})

export async function inviteUser(formData: FormData) {
  const admin = await requirePermission('users:invite')

  // D4 in-demo gate: inviting real people into the shared, publicly-reachable demo
  // workspace is nonsensical (and would send a real email to a stranger's address).
  if (isDemoWorkspace(admin.workspaceId)) {
    redirectWithError('/settings/users', DEMO_USERS_BLOCKED_MESSAGE)
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'OPERATOR',
  })

  if (!parsed.success) {
    redirectWithError('/settings/users', parsed.error.issues[0].message)
  }

  const { email, role } = parsed.data

  // next=/auth/set-password: invited users have no password yet — the callback route
  // already supports ?next= (defaults to /dashboard for every other flow) and lands
  // them straight on the set-password form instead of a passwordless dashboard visit.
  const admin_client = createServiceClient()
  const { data, error } = await admin_client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${AUTH_CALLBACK_URL}?next=${encodeURIComponent('/auth/set-password')}`,
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

  // D4 in-demo gate: deactivating another visitor's shared profile would be a confusing,
  // permanent-feeling action in a sandbox that resets nightly regardless.
  if (isDemoWorkspace(admin.workspaceId)) {
    redirectWithError('/settings/users', DEMO_USERS_BLOCKED_MESSAGE)
  }

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

// D7 — manual emergency reset, deferred from the demo-mode spec §3 (flagged by the D2
// build): wipes and reseeds the shared public demo workspace on demand instead of
// waiting for the next visitor's 24h stale-on-entry check to trigger it. Deliberately
// gated to canManuallyResetDemo (SUPER_ADMIN only) rather than requirePermission —
// this is narrower than the ADMIN_PERMISSIONS matrix that treats OWNER the same as
// SUPER_ADMIN everywhere else, because this control can nuke a shared, publicly-
// reachable workspace out from under every visitor currently in it. Unreachable and
// (via the page-side check mirroring canManuallyResetDemo) invisible for every other
// role, including OWNER.
export async function resetDemoWorkspaceManually() {
  const user = await requireWorkspace()

  if (!isDemoEnabled() || !canManuallyResetDemo(user.role)) {
    throw new Error('Not authorized.')
  }

  const demoWorkspaceId = process.env.DEMO_WORKSPACE_ID
  if (!demoWorkspaceId) {
    redirectWithError('/settings/users', 'Demo workspace is not configured.')
  }

  const result = await resetDemoWorkspaceData(demoWorkspaceId)
  if (!result.ok) {
    console.error('resetDemoWorkspaceManually:', result.error)
    redirectWithError('/settings/users', 'Reset failed — check the server logs.')
  }

  revalidatePath('/settings/users')
  redirect('/settings/users?resetDemo=ok')
}
