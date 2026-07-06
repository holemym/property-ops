import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

// Invitation-voice empty state. Preferred API is { icon, title, body?, action? }:
//   - icon:   a rendered lucide icon (or any node); shown muted above the title
//   - title:  sentence-case headline
//   - body:   optional supporting line
//   - action: optional CTA node (a <Button>, link, etc.)
//
// The legacy { description, actionLabel, actionHref } props are still accepted so
// existing call sites keep working; new code should use body/action.
export function EmptyState({
  icon,
  title,
  body,
  action,
  description,
  actionLabel,
  actionHref,
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  /** @deprecated use `body` */
  description?: string
  /** @deprecated use `action` */
  actionLabel?: string
  /** @deprecated use `action` */
  actionHref?: string
}) {
  const supporting = body ?? description
  const legacyAction =
    actionLabel && actionHref ? (
      <Button render={<Link href={actionHref} />}>{actionLabel}</Button>
    ) : null

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      {icon && <div className="mb-1 text-muted-foreground [&>svg]:size-6">{icon}</div>}
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {supporting && <p className="max-w-sm text-sm text-muted-foreground">{supporting}</p>}
      {(action || legacyAction) && <div className="mt-2">{action ?? legacyAction}</div>}
    </div>
  )
}
