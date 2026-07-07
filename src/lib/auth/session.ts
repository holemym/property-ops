import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { redirectWithError } from '@/lib/redirect-with-error'
import { assertPermission, type Permission } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

export type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: Role
  workspaceId: string | null
  isActive: boolean
}

// Wrapped in React cache() so the auth.getUser() + profile lookup runs ONCE per request
// even though the (app) layout and every page call the require* chain — collapsing the
// repeated round-trips that made each navigation do redundant auth work.
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, workspace_id, is_active')
    .eq('id', user.id)
    .single()

  // Note: any Supabase error here (missing profile, network issue, etc.) is treated
  // the same — falls through to redirect-to-login. Acceptable for MVP; revisit if this
  // causes confusing "logged in but bounced to /login" reports once live.
  if (!profile) return null

  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name,
    role: profile.role as Role,
    workspaceId: profile.workspace_id,
    isActive: profile.is_active,
  }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // Deactivated users keep a valid JWT until it expires, so getCurrentUser() still
  // resolves them. Bounce them here — this is the single app-layer chokepoint that
  // every gate flows through (requireWorkspace, requirePermission, and the (app)
  // layout all call requireUser), so enforcing is_active once here covers every
  // authenticated page. /login is a PUBLIC_PATH (see proxy.ts), so the redirect
  // does not loop, and the login page renders the ?error message.
  // NOTE: this is app-layer defense-in-depth; it does not revoke the Supabase Auth
  // session itself (that would need auth.admin ban_duration — tracked in
  // setUserActive). RLS + this check together are sufficient for now.
  if (!user.isActive) {
    redirectWithError('/login', 'Your account has been deactivated.')
  }
  return user
}

export async function requireWorkspace(): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireUser()
  if (!user.workspaceId) redirect('/workspace/new')
  return user as CurrentUser & { workspaceId: string }
}

// Unlike requireUser/requireWorkspace (which redirect), a permission failure here
// throws a plain Error, surfaced via Next.js's default error boundary. Revisit if
// Server Actions need friendlier "you don't have permission" UX later.
export async function requirePermission(permission: Permission): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireWorkspace()
  assertPermission(user.role, permission)
  return user
}
