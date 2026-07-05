import type { Role } from '@/types/domain'

export type Permission =
  | 'workspace:manage'
  | 'properties:read'
  | 'properties:write'
  | 'units:read'
  | 'units:write'
  | 'vendors:read'
  | 'vendors:write'
  | 'users:invite'
  | 'users:manage'
  | 'tickets:read'
  | 'tickets:write'
  | 'tickets:assign'
  | 'tickets:comment-internal'

const MANAGER_PERMISSIONS: Permission[] = [
  'properties:read',
  'properties:write',
  'units:read',
  'units:write',
  'vendors:read',
  'vendors:write',
  // Managers (OPERATOR + OWNER/SUPER_ADMIN via ADMIN_PERMISSIONS) get the full
  // ticket surface. tickets:read is also granted explicitly to ACCOUNTANT below
  // for read-only oversight (per P3.1 RLS tickets_select_manager_or_accountant).
  'tickets:read',
  'tickets:write',
  'tickets:assign',
  'tickets:comment-internal',
]

const ADMIN_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  'workspace:manage',
  'users:invite',
  'users:manage',
]

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  OWNER: ADMIN_PERMISSIONS,
  OPERATOR: [...MANAGER_PERMISSIONS],
  ACCOUNTANT: ['properties:read', 'units:read', 'vendors:read', 'tickets:read'],
  TENANT: [],
  GUEST: [],
  VENDOR: [],
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

// Role-MEMBERSHIP predicate for the tenant/guest self-service surface (P3.7 portal).
// This is deliberately NOT expressed through the permission matrix: TENANT and GUEST
// hold ZERO ticket-matrix permissions (see ROLE_PERMISSIONS above — every tickets:*
// is denied), so the operator ticket pages gate them out via requirePermission. The
// portal is a SEPARATE surface those two roles reach by ROLE, and RLS (own-rows
// SELECT/INSERT, PUBLIC-comment-only) is the real enforcement of what they can touch.
// VENDOR is intentionally EXCLUDED — vendors are not portal tenants (their surface is
// out of scope here); only the reporting/self-service roles return true.
export function isTenantRole(role: Role): boolean {
  return role === 'TENANT' || role === 'GUEST'
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Role ${role} lacks permission ${permission}`)
  }
}
