'use client'

import Link from 'next/link'
import { Bell, ChevronsUpDown, LogOut, User } from 'lucide-react'
import { signOut } from '@/app/(auth)/actions'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { MobileNav } from './MobileNav'
import { CommandPalette } from '@/components/search/CommandPalette'
import { isTenantRole } from '@/lib/auth/permissions'
import { formatUnreadBadge } from '@/lib/notifications/unread-badge'
import type { Role } from '@/types/domain'

// Initials for the avatar chip — first letters of up to two words, upper-cased. Falls
// back to a person glyph when the name is empty.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
}

export function TopNav({
  userName,
  role,
  workspaceName,
  unreadCount = 0,
}: {
  userName: string
  role: Role
  workspaceName: string
  unreadCount?: number
}) {
  const glyph = initials(userName)
  const badge = formatUnreadBadge(unreadCount)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background px-4 sm:gap-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only; opens the nav drawer. */}
        <MobileNav role={role} />
        <WorkspaceSwitcher role={role} workspaceName={workspaceName} />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Command palette (⌘K) — search + navigation; operator surface only. */}
        {!isTenantRole(role) && <CommandPalette role={role} />}

        {/* Notifications bell (P2-2) — operators AND tenants; the portal renders this
            same TopNav, so this is the rare surface both roles share (spec §3). Always
            rendered; the count chip only appears once unreadCount > 0, capped at "9+"
            (formatUnreadBadge). Count is server-fetched per navigation in the (app)
            layout — no client polling. */}
        <Button
          variant="ghost"
          size="icon"
          render={<Link href="/notifications" />}
          nativeButton={false}
          aria-label={badge ? `Notifications, ${unreadCount} unread` : 'Notifications'}
          className="relative"
        >
          <Bell className="size-4" />
          {badge && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-medium text-primary-foreground"
            >
              {badge}
            </span>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className={cn(
              'group flex items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none',
              'transition-colors duration-[--duration-fast] ease-[--ease-out]',
              'hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-accent'
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
              {glyph || <User className="size-4 text-muted-foreground" />}
            </span>
            <span className="hidden max-w-40 truncate font-medium text-foreground sm:block">
              {userName}
            </span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-56">
            <DropdownMenuLabel>
              <span className="block truncate font-medium text-foreground">{userName}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {workspaceName}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => signOut()}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
