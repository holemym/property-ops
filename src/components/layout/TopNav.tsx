import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { Role } from '@/types/domain'

export function TopNav({
  userName,
  role,
  workspaceName,
}: {
  userName: string
  role: Role
  workspaceName: string
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b px-6">
      <WorkspaceSwitcher role={role} workspaceName={workspaceName} />
      <span className="text-sm text-muted-foreground">{userName}</span>
    </header>
  )
}
