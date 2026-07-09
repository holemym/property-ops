import { requireWorkspace } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'
import { Toaster } from '@/components/ui/sonner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWorkspace()
  const supabase = await createClient()
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('name')
    .eq('id', user.workspaceId)
    .single()

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
      <Sidebar role={user.role} />
      {/* min-w-0 lets the content column shrink below the sidebar width so wide tables
          scroll inside it rather than pushing the layout on small screens. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav userName={user.fullName || user.email} role={user.role} workspaceName={workspace?.name ?? ''} />
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 focus:outline-none">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  )
}
