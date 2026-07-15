import { requireWorkspace } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'
import { DemoBanner } from '@/components/layout/DemoBanner'
import { Toaster } from '@/components/ui/sonner'
import { isDemoWorkspace } from '@/lib/demo'
import { countUnread } from '@/lib/data/notifications'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWorkspace()
  const supabase = await createClient()
  // Run alongside the workspace-name fetch — both are independent reads off the same
  // request. The TopNav bell (P2-2) is server-fetched per navigation (this layout wraps
  // every route, operator AND portal alike), so the chip is never stale across a click
  // without needing any client-side polling.
  //
  // countUnread is deliberately swallowed here (unlike its call on /notifications itself,
  // where a failure should be visible): this layout wraps EVERY route in the app, so an
  // unguarded throw here would take down the entire shell over a notifications-only
  // problem — e.g. migration 0026 not yet applied in an environment (still a standing
  // USER-action item as of P2-1). Defaulting to 0 just means the bell shows with no chip,
  // which is the correct degraded state, not a 500 on every page.
  const [{ data: workspace }, unreadCount] = await Promise.all([
    supabase.from('workspaces').select('name').eq('id', user.workspaceId).single(),
    countUnread(supabase, user.workspaceId, user.id).catch((e) => {
      console.error('Failed to fetch unread notification count for TopNav', e)
      return 0
    }),
  ])

  return (
    <div className="flex h-screen">
      {/* Keyboard skip link — first focusable element, hidden until focused, jumps past the
          nav straight to the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[60] focus:not-sr-only focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-background focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <Sidebar role={user.role} isDemo={isDemoWorkspace(user.workspaceId)} />
      {/* min-w-0 lets the content column shrink below the sidebar width so wide tables
          scroll inside it rather than pushing the layout on small screens. */}
      <div className="flex min-w-0 flex-1 flex-col">
        {isDemoWorkspace(user.workspaceId) && <DemoBanner />}
        <TopNav
          userName={user.fullName || user.email}
          role={user.role}
          workspaceName={workspace?.name ?? ''}
          isDemo={isDemoWorkspace(user.workspaceId)}
          unreadCount={unreadCount}
        />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 focus:outline-none">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
