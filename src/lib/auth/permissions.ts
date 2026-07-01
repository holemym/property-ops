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

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: [...MANAGER_PERMISSIONS, 'workspace:manage', 'users:invite', 'users:manage'],
  OWNER: [...MANAGER_PERMISSIONS, 'workspace:manage', 'users:invite', 'users:manage'],
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
