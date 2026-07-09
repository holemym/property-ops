'use client'

import { useEffect, useRef, useState } from 'react'
import { Menu } from 'lucide-react'
import { SidebarContent } from './Sidebar'
import type { Role } from '@/types/domain'

// Mobile navigation: a hamburger (shown below md) that opens the sidebar as an off-canvas
// drawer. Tapping a destination closes it (SidebarContent's onNavigate), as does the
// backdrop or Escape. Hidden entirely at md+, where the static rail is visible.
export function MobileNav({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Escape closes (listener only — no setState in the effect body).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // While open: lock background scroll and return focus to the hamburger on close (cleanup runs
  // when `open` flips false or on unmount). DOM side effects only — no setState in the body.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const trigger = triggerRef.current
    return () => {
      document.body.style.overflow = prevOverflow
      trigger?.focus()
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
      >
        <Menu className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div
            className="absolute inset-0 bg-black/40 motion-safe:animate-in motion-safe:fade-in-0"
            onClick={() => setOpen(false)}
          />
          <nav className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar shadow-lg motion-safe:animate-in motion-safe:slide-in-from-left motion-safe:duration-[--duration-base]">
            <SidebarContent role={role} onNavigate={() => setOpen(false)} />
          </nav>
        </div>
      )}
    </>
  )
}
