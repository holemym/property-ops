import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { can, type Permission } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

export type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: Role
  workspaceId: string | null
  isActive: boolean
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
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

  if (!profile) return null

  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name,
    role: profile.role as Role,
    workspaceId: profile.workspace_id,
    isActive: profile.is_active,
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export async function requireWorkspace(): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireUser()
  if (!user.workspaceId) redirect('/workspace/new')
  return user as CurrentUser & { workspaceId: string }
}

export async function requirePermission(permission: Permission): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireWorkspace()
  if (!can(user.role, permission)) {
    throw new Error(`Role ${user.role} lacks permission ${permission}`)
  }
  return user
}
