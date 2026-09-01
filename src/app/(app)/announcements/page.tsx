import { Megaphone } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listAnnouncements } from '@/lib/data/announcements'
import { listProperties } from '@/lib/data/properties'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { NewAnnouncementDialog } from '@/components/announcements/NewAnnouncementDialog'
import { EditAnnouncementDialog } from '@/components/announcements/EditAnnouncementDialog'
import { PublishedToast } from '@/components/announcements/PublishedToast'
import { formatDate } from '@/lib/format-date'
import {
  createAnnouncementAction,
  publishAnnouncementAction,
  unpublishAnnouncementAction,
  updateAnnouncementAction,
} from './actions'

export default async function AnnouncementsPage() {
  // Managers + accountant hold announcements:read; accountant is read-only (no
  // announcements:write) — same split as the documents hub.
  const user = await requirePermission('announcements:read')
  const canWrite = can(user.role, 'announcements:write')
  const supabase = await createClient()

  const [announcements, properties] = await Promise.all([
    listAnnouncements(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
  ])
  const propertyNameById = new Map(properties.map((p) => [p.id, p.name]))
  const propertyOptions = properties.map((p) => ({ id: p.id, label: p.name }))

  const composeDialog = canWrite ? (
    <NewAnnouncementDialog action={createAnnouncementAction} properties={propertyOptions} />
  ) : null

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PublishedToast />

      <PageHeader
        title="Announcements"
        subtitle="Share notices with your residents — workspace-wide, or targeted to one property."
        actions={composeDialog}
      />

      {announcements.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="No announcements yet"
          body={
            canWrite
              ? 'Compose a notice and publish it to make it visible on the resident portal.'
              : 'Once a manager composes a notice, it will appear here.'
          }
          action={composeDialog ?? undefined}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {announcements.map((a) => {
            const boundPublish = publishAnnouncementAction.bind(null, a.id)
            const boundUnpublish = unpublishAnnouncementAction.bind(null, a.id)
            const isPublished = a.status === 'PUBLISHED'
            return (
              <Card key={a.id}>
                <CardHeader>
                  <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="min-w-0 break-words">{a.title}</span>
                    <StatusBadge kind="announcement_status" value={a.status} />
                    {a.property_id && (
                      <Badge variant="outline">
                        {propertyNameById.get(a.property_id) ?? 'Unknown property'}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isPublished && a.published_at
                      ? `Published ${formatDate(a.published_at)}`
                      : `Created ${formatDate(a.created_at)}`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
                    {a.body}
                  </p>
                  {canWrite && (
                    <div className="flex justify-end gap-2">
                      <EditAnnouncementDialog
                        action={updateAnnouncementAction.bind(null, a.id)}
                        properties={propertyOptions}
                        announcement={{
                          id: a.id,
                          title: a.title,
                          body: a.body,
                          propertyId: a.property_id,
                        }}
                      />
                      {isPublished ? (
                        <form action={boundUnpublish}>
                          <SubmitButton variant="outline" size="sm" pendingLabel="Updating">
                            Move to draft
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={boundPublish}>
                          <SubmitButton size="sm" pendingLabel="Publishing">
                            Publish
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
