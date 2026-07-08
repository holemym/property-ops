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
      <Sidebar role={user.role} />
      {/* min-w-0 lets the content column shrink below the sidebar width so wide tables
          scroll inside it rather than pushing the layout on small screens. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav userName={user.fullName || user.email} role={user.role} workspaceName={workspace?.name ?? ''} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>
      <Toaster />
    </div>
  )
}
