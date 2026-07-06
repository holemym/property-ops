'use client'

import { ChevronsUpDown, LogOut, User } from 'lucide-react'
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
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
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
}: {
  userName: string
  role: Role
  workspaceName: string
}) {
  const glyph = initials(userName)

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b bg-background px-6">
      <WorkspaceSwitcher role={role} workspaceName={workspaceName} />

      <DropdownMenu>
        <DropdownMenuTrigger
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
    </header>
  )
}
