'use client'

import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  DoorOpen,
  CalendarClock,
  ReceiptText,
  Wrench,
  Ticket,
  LayoutGrid,
  CalendarDays,
  ChartColumn,
  Wallet,
  Receipt,
  Users,
  FileText,
  Inbox,
  CirclePlus,
  Building,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { can, isTenantRole, type Permission } from '@/lib/auth/permissions'
import type { Role } from '@/types/domain'

// A nav item may declare a `permission` — when set, the link only renders for roles
// that hold it. Items without one show for every operator-surface role.
type NavItem = { href: string; label: string; icon: LucideIcon; permission?: Permission }
// Items are grouped into labelled sections so the (now ~15-item) operator nav reads as a
// small set of areas rather than one long flat list. An empty `label` renders headerless.
type NavGroup = { label: string; items: NavItem[] }

// Operator nav, grouped by area. Tenants/guests get TENANT_NAV instead (they hold none of
// these permissions). Per-item `permission` still hides individual links a role lacks; a
// group whose items all filter out is dropped entirely.
const OPERATOR_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Portfolio',
    items: [
      { href: '/properties', label: 'Properties', icon: Building2 },
      { href: '/units', label: 'Units', icon: DoorOpen },
      { href: '/occupancy', label: 'Occupancy', icon: CalendarClock, permission: 'occupancy:read' },
      { href: '/rent-roll', label: 'Rent roll', icon: ReceiptText, permission: 'occupancy:read' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/tickets', label: 'Tickets', icon: Ticket },
      { href: '/tickets/board', label: 'Board', icon: LayoutGrid, permission: 'tickets:read' },
      { href: '/calendar', label: 'Calendar', icon: CalendarDays, permission: 'tickets:read' },
      { href: '/vendors', label: 'Vendors', icon: Wrench },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/finance', label: 'Finance', icon: Wallet, permission: 'finance:read' },
      { href: '/invoices', label: 'Invoices', icon: Receipt, permission: 'finance:read' },
      { href: '/owners', label: 'Owners', icon: Users, permission: 'finance:read' },
      { href: '/insights', label: 'Insights', icon: ChartColumn, permission: 'analytics:read' },
    ],
  },
  {
    label: 'Records',
    items: [
      { href: '/documents', label: 'Documents', icon: FileText, permission: 'documents:read' },
    ],
  },
]

// Minimal tenant/guest nav — the self-service portal only, headerless.
const TENANT_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      { href: '/portal', label: 'My requests', icon: Inbox },
      { href: '/portal/new', label: 'Report an issue', icon: CirclePlus },
    ],
  },
]

// A nav href "matches" when the current path is that link or nested under it, so
// /properties/123 keeps Properties lit. The `/` boundary guard keeps a bare /portal from
// lighting when on /portal/new.
function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

// The brand + grouped nav, reused by the desktop rail (Sidebar) and the mobile drawer
// (MobileNav). `onNavigate` (optional) fires when a link is clicked — the drawer passes a
// close handler so tapping a destination dismisses it.
export function SidebarContent({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname()

  // Filter each group's items by permission, then drop groups left empty.
  const groups = (isTenantRole(role) ? TENANT_GROUPS : OPERATOR_GROUPS)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(role, item.permission)),
    }))
    .filter((group) => group.items.length > 0)

  // Active item = the LONGEST matching href across ALL visible items, so a nested route
  // with its own entry (e.g. /tickets/board) lights only itself, not also its parent.
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((item) => matchesPath(pathname, item.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <>
      {/* Workspace mark — a graphite emblem block anchoring the shell. */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
          <Building className="size-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Property Ops
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        {groups.map((group, i) => (
          <div key={group.label || `group-${i}`} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={item.href === activeHref ? 'page' : undefined}
                className={cn(
                  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-[--duration-fast] ease-[--ease-out]',
                  item.href === activeHref
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <NavItemBody item={item} active={item.href === activeHref} />
              </Link>
            ))}
          </div>
        ))}
      </div>
    </>
  )
}

// The desktop rail — hidden below md, where the MobileNav drawer takes over.
export function Sidebar({ role }: { role: Role }) {
  return (
    <nav className="hidden h-full w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
      <SidebarContent role={role} />
    </nav>
  )
}

// Rendered INSIDE <Link> so useLinkStatus() can report this link's own navigation state —
// the icon swaps to a spinner the instant it's clicked, giving immediate feedback even
// while the next page's data is still loading on the server.
function NavItemBody({ item, active }: { item: NavItem; active: boolean }) {
  const { pending } = useLinkStatus()
  const Icon = item.icon
  return (
    <>
      {pending ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <Icon
          className={cn(
            'size-4 shrink-0 transition-colors',
            active ? 'text-background' : 'text-muted-foreground group-hover:text-accent-foreground',
          )}
        />
      )}
      {item.label}
    </>
  )
}
