import type { Role } from '@/types/domain'

export type Permission =
  | 'workspace:manage'
  | 'properties:read'
  | 'properties:write'
  | 'units:read'
  | 'units:write'
  | 'occupancy:read'
  | 'vendors:read'
  | 'vendors:write'
  | 'users:invite'
  | 'users:manage'
  | 'tickets:read'
  | 'tickets:write'
  | 'tickets:assign'
  | 'tickets:comment-internal'
  | 'analytics:read'
  | 'finance:read'
  | 'finance:write'

const MANAGER_PERMISSIONS: Permission[] = [
  'properties:read',
  'properties:write',
  'units:read',
  'units:write',
  // occupancy:read — the occupancy timeline (tenancies carry PII; gated to
  // managers + accountant, matching the tenancies_select_manager_or_accountant RLS
  // policy). Granted explicitly to ACCOUNTANT below for read-only oversight.
  'occupancy:read',
  'vendors:read',
  'vendors:write',
  // Managers (OPERATOR + OWNER/SUPER_ADMIN via ADMIN_PERMISSIONS) get the full
  // ticket surface. tickets:read is also granted explicitly to ACCOUNTANT below
  // for read-only oversight (per P3.1 RLS tickets_select_manager_or_accountant).
  'tickets:read',
  'tickets:write',
  'tickets:assign',
  'tickets:comment-internal',
  // analytics:read — the insights dashboard (cost/vendor/unit/cycle metrics). Granted
  // to every manager role here and to ACCOUNTANT below for read-only oversight. Tenants,
  // guests and vendors are excluded (no reporting surface).
  'analytics:read',
  // finance:read — the bookkeeping surface (income/expense, profit-per-unit). Operators
  // need cost visibility, so read is granted to every manager role here (+ ACCOUNTANT
  // below). finance:WRITE, however, is the finance role-inversion: it is NOT granted
  // here (would give OPERATOR write) — it lives in ADMIN_PERMISSIONS + ACCOUNTANT only.
  'finance:read',
]

const ADMIN_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  'workspace:manage',
  'users:invite',
  'users:manage',
  // finance:write — SUPER_ADMIN/OWNER (here) and ACCOUNTANT (below) keep the books;
  // OPERATOR is deliberately excluded (has finance:read via MANAGER only). Matches the
  // can_manage_finance() RLS helper in migration 0017.
  'finance:write',
]

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  OWNER: ADMIN_PERMISSIONS,
  OPERATOR: [...MANAGER_PERMISSIONS],
  ACCOUNTANT: [
    'properties:read',
    'units:read',
    'occupancy:read',
    'vendors:read',
    'tickets:read',
    'analytics:read',
    // ACCOUNTANT owns the books — its FIRST write permission.
    'finance:read',
    'finance:write',
  ],
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
