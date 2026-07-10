import { Bell, Wrench, FileClock, DoorOpen } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

// Static mock of the upcoming in-app notifications feature (Track P2) — demo-workspace
// only, presentational, no data layer. Delete this file + its Sidebar entry when P2 ships.
const ITEMS = [
  {
    icon: Wrench,
    title: 'Ticket assigned to you',
    body: '"Heizung faellt aus" · Ringstrasse Residenz',
    when: '2h ago',
    unread: true,
  },
  {
    icon: Wrench,
    title: 'Ticket resolved',
    body: '"Wasserschaden im Bad" was marked resolved',
    when: '1d ago',
    unread: true,
  },
  {
    icon: FileClock,
    title: 'Document expiring soon',
    body: 'Gas safety certificate — Top 1 expires in 25 days',
    when: '2d ago',
    unread: false,
  },
  {
    icon: DoorOpen,
    title: 'Lease ending soon',
    body: 'Cafe Sonne GmbH — Shop EG ends in 45 days',
    when: '3d ago',
    unread: false,
  },
]

export default async function PreviewNotificationsPage() {
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Notifications"
        subtitle="What needs your attention, in one inbox."
        actions={<Badge variant="muted">Planned — preview</Badge>}
      />

      <Card className="divide-y p-0">
        {ITEMS.map((item) => (
          <div key={item.title} className="flex items-start gap-3 px-4 py-3.5">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <item.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.body}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-muted-foreground">{item.when}</span>
              {item.unread && <span className="size-2 rounded-full bg-primary" aria-hidden />}
            </div>
          </div>
        ))}
      </Card>

      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Bell className="size-4" />
        The real version will fill this inbox from the same events already logged on
        tickets and documents today — nothing new to track, just a place to see it.
      </p>
    </div>
  )
}
