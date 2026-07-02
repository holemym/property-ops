import { requireWorkspace } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopNav } from '@/components/layout/TopNav'

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
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopNav userName={user.fullName || user.email} role={user.role} workspaceName={workspace?.name ?? ''} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  )
}
