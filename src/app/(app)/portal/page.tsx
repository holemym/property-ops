import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Inbox, ChevronRight } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { Badge } from '@/components/ui/badge'
import { tenantStatusLabel } from '@/lib/portal-status'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/format-date'

export default async function PortalPage() {
  const user = await requireWorkspace()
  // Tenant-only surface. Managers/accountant who somehow reach /portal go to their real
  // ticket inbox — the portal is not for them. Tenants land and stay here.
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()
  // RLS scopes rows to THIS tenant's own tickets (created_by OR, post-0013, created_for
  // = them). No filter UI needed — tenants have few requests. Newest-first via listTickets.
  const tickets = await listTickets(supabase, user.workspaceId)

  return (
    <div className="flex flex-col">
      <ErrorToast />

      <PageHeader
        title="My requests"
        subtitle="Track the maintenance requests you've reported."
        actions={
          <Button render={<Link href="/portal/new" />}>Report an issue</Button>
        }
      />

      {tickets.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No requests yet"
          body="Report a maintenance issue and follow its progress here."
          action={<Button render={<Link href="/portal/new" />}>Report an issue</Button>}
        />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/portal/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium text-foreground">
                      {t.title}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {t.category.replace(/_/g, ' ').toLowerCase()} · {formatDate(t.created_at)}
                    </span>
                  </div>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{tenantStatusLabel(t.status)}</Badge>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
