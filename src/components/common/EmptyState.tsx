import type { ReactNode } from 'react'

// Invitation-voice empty state:
//   - icon:   a rendered lucide icon (or any node); shown muted above the title
//   - title:  sentence-case headline
//   - body:   optional supporting line
//   - action: optional CTA node (a <Button>, link, etc.)
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      {icon && <div className="mb-1 text-muted-foreground [&>svg]:size-6">{icon}</div>}
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
