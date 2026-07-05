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

export function assertPermission(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new Error(`Role ${role} lacks permission ${permission}`)
  }
}
