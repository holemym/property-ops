import type { Role } from '@/types/domain'

export function WorkspaceSwitcher({ role, workspaceName }: { role: Role; workspaceName: string }) {
  if (role !== 'SUPER_ADMIN') {
    return <span className="text-sm font-medium">{workspaceName}</span>
  }

  return <span className="text-sm font-medium">{workspaceName} (Super Admin)</span>
}
