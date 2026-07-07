'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  DoorOpen,
  CalendarClock,
  Wrench,
  Ticket,
  ChartColumn,
  Inbox,
  CirclePlus,
  Building,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can, isTenantRole, type Permission } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

// A nav item may declare a `permission` — when set, the link only renders for roles
// that hold it. Items without one show for every operator-surface role (dashboard etc.).
type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission }

// Operator nav — the full portfolio surface. Tenants/guests hold NONE of the
// permissions these pages gate on (properties/units/vendors/tickets), so showing them
// these links would only lead to permission errors. They get TENANT_NAV instead.
// Occupancy sits between Units and Vendors and is gated on occupancy:read — managers +
// accountant see it; it stays hidden from any operator-surface role that lacks it.
const OPERATOR_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/properties', label: 'Properties', icon: Building2 },
  { href: '/units', label: 'Units', icon: DoorOpen },
  { href: '/occupancy', label: 'Occupancy', icon: CalendarClock, permission: 'occupancy:read' },
  { href: '/vendors', label: 'Vendors', icon: Wrench },
  { href: '/tickets', label: 'Tickets', icon: Ticket },
  // Insights sits after Tickets, gated on analytics:read — managers + accountant see the
  // cost/vendor/unit/cycle dashboard; it stays hidden from any role that lacks it.
  { href: '/insights', label: 'Insights', icon: ChartColumn, permission: 'analytics:read' },
]

// Minimal tenant/guest nav — the P3.7 self-service portal only.
const TENANT_NAV: NavItem[] = [
  { href: '/portal', label: 'My requests', icon: Inbox },
  { href: '/portal/new', label: 'Report an issue', icon: CirclePlus },
]

// A nav link is "active" when the current path is that link or nested under it, so
// /properties/123 keeps the Properties item lit. The exact "/" guard keeps a bare
// /portal from lighting up when on /portal/new (both share the prefix), by requiring
// the next char to be a boundary.
function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const nav = isTenantRole(role)
    ? TENANT_NAV
    : OPERATOR_NAV.filter((item) => !item.permission || can(role, item.permission))

  return (
    <nav className="flex h-full w-56 flex-col border-r bg-sidebar">
      {/* Workspace mark — a graphite emblem block anchoring the shell. */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <Building className="size-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Property Ops
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-3">
        {nav.map((item) => {
          const active = isActive(pathname, item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[--duration-fast] ease-[--ease-out]',
                active
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0 transition-colors',
                  active ? 'text-background' : 'text-muted-foreground group-hover:text-accent-foreground'
                )}
              />
              {item.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
