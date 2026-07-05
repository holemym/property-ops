import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { TicketStatusBadge } from '@/components/tickets/TicketBadges'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Requests</h1>
        <Button render={<Link href="/portal/new" />}>Report an issue</Button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          title="No requests yet"
          description="Report an issue and it'll show up here."
          actionLabel="Report an issue"
          actionHref="/portal/new"
        />
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/portal/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-accent"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{t.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {t.category.replace(/_/g, ' ')} · {formatDate(t.created_at)}
                  </span>
                </div>
                <TicketStatusBadge status={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
