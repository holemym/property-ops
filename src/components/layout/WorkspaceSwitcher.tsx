import type { Role } from '@/types/domain'

// Read-only workspace label in the top nav. A single workspace per session today, so
// this is a name plate rather than a switcher; SUPER_ADMIN gets a quiet tag so the
// elevated context is legible without adding saturated color.
export function WorkspaceSwitcher({ role, workspaceName }: { role: Role; workspaceName: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-sm font-semibold tracking-tight text-foreground">
        {workspaceName}
      </span>
      {role === 'SUPER_ADMIN' && (
        <span className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          Super admin
        </span>
      )}
    </div>
  )
}
