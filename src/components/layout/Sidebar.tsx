import Link from 'next/link'
import { isTenantRole } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

// Operator nav — the full portfolio surface. Tenants/guests hold NONE of the
// permissions these pages gate on (properties/units/vendors/tickets), so showing them
// these links would only lead to permission errors. They get TENANT_NAV instead.
const OPERATOR_NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/properties', label: 'Properties' },
  { href: '/units', label: 'Units' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/tickets', label: 'Tickets' },
]

// Minimal tenant/guest nav — the P3.7 self-service portal only.
const TENANT_NAV = [
  { href: '/portal', label: 'My Requests' },
  { href: '/portal/new', label: 'Report an Issue' },
]

export function Sidebar({ role }: { role: Role }) {
  const nav = isTenantRole(role) ? TENANT_NAV : OPERATOR_NAV
  return (
    <nav className="flex h-full w-56 flex-col gap-1 border-r px-3 py-4">
      {nav.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
