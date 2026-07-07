import type { ReactNode } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from '@/components/ui/card'

// Thin wrapper over the shared Card that gives every hub section a consistent
// title + optional right-aligned action (e.g. a "View all" link) and body slot.
// Self-contained so the hub does not couple to any unit-hub component.
export function HubCard({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{title}</CardTitle>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
