import { redirect } from 'next/navigation'
import { Megaphone } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listPublishedAnnouncementsForTenant } from '@/lib/data/announcements'
import { getProperty } from '@/lib/data/properties'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format-date'

export default async function PortalAnnouncementsPage() {
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()
  // RLS (announcements_select_published_for_tenant, migration 0030) narrows this to
  // PUBLISHED rows the caller is entitled to: any workspace-wide notice, plus
  // property-targeted notices only where the caller holds an ACTIVE tenancy in that
  // property. A tenant never sees a DRAFT, regardless of workspace/property match.
  const items = await listPublishedAnnouncementsForTenant(supabase, user.workspaceId)

  // Property labels only (properties are open-select to workspace members, 0003) —
  // never resolve tenancy info here.
  const propertyIds = [...new Set(items.map((a) => a.property_id).filter((id): id is string => Boolean(id)))]
  const properties = await Promise.all(propertyIds.map((id) => getProperty(supabase, user.workspaceId, id)))
  const propertyNameById = new Map(
    properties.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => [p.id, p.name])
  )

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />

      <PageHeader title="Announcements" subtitle="Notices from your property manager." />

      {items.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="No announcements"
          body="Notices from your building will appear here."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {items.map((a) => (
            <Card key={a.id}>
              <CardHeader>
                <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words">{a.title}</span>
                  {a.property_id && (
                    <Badge variant="outline">{propertyNameById.get(a.property_id) ?? 'This property'}</Badge>
                  )}
                </CardTitle>
                <CardDescription>{formatDate(a.published_at ?? a.created_at)}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-foreground">
                  {a.body}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
