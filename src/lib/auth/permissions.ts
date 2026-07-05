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

const MANAGER_PERMISSIONS: Permission[] = [
  'properties:read',
  'properties:write',
  'units:read',
  'units:write',
  'vendors:read',
  'vendors:write',
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
  ACCOUNTANT: ['properties:read', 'units:read', 'vendors:read'],
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
