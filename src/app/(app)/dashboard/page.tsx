import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets, countTicketsByStatus, type Ticket } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { TicketPriorityBadge, TicketStatusBadge } from '@/components/tickets/TicketBadges'
import type { TicketStatus } from '@/types/domain'

// Per-widget cap — the dashboard shows short curated slices, not the full inbox. Each
// list links to the filtered inbox ("View all →") for the complete set.
const LIST_CAP = 8
const RECENT_CAP = 6

// Terminal statuses — a ticket in one of these is "done" and does not count as open.
const TERMINAL: TicketStatus[] = ['CLOSED', 'CANCELLED']
const isOpen = (t: Ticket) => !TERMINAL.includes(t.status)

// The status cards shown in the top strip, in operational reading order.
const STRIP_STATUSES: TicketStatus[] = [
  'NEW',
  'TRIAGE',
  'WAITING_FOR_INFO',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

export default async function DashboardPage() {
  // Tenants/guests have no operator dashboard — land them on their portal instead
  // (preserved from the P3.7 placeholder). Managers/OWNER/SUPER_ADMIN/ACCOUNTANT stay.
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  const supabase = await createClient()
  // A handful of curated slices + one status tally + the property name map, all in
  // parallel (not N+1). RLS scopes every query to this workspace. listTickets has no
  // server-side LIMIT today (Phase-4 optimization), so widgets slice in JS below;
  // workspace ticket volume is bounded at MVP scale.
  const [counts, newTickets, urgentTickets, waitingTickets, mineTickets, allTickets, properties] =
    await Promise.all([
      countTicketsByStatus(supabase, user.workspaceId),
      listTickets(supabase, user.workspaceId, { status: 'NEW' }),
      listTickets(supabase, user.workspaceId, { priority: 'URGENT' }),
      listTickets(supabase, user.workspaceId, { status: 'WAITING_FOR_INFO' }),
      listTickets(supabase, user.workspaceId, { assignedOperatorId: user.id }),
      // For the "recently resolved/closed" widget we need RESOLVED-or-CLOSED sorted by
      // recency — a set the data layer's single-status filter can't express — so fetch
      // the workspace list once and derive it in JS.
      listTickets(supabase, user.workspaceId),
      listProperties(supabase, user.workspaceId),
    ])

  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))

  // "Open" headline = every non-terminal ticket (sum of all statuses except CLOSED/CANCELLED).
  const openCount = Object.entries(counts).reduce(
    (sum, [status, n]) => (TERMINAL.includes(status as TicketStatus) ? sum : sum + (n ?? 0)),
    0
  )

  // Urgent fires: URGENT and still non-terminal. listTickets is newest-first already.
  const urgentOpen = urgentTickets.filter(isOpen).slice(0, LIST_CAP)
  // My queue: assigned to me and still non-terminal.
  const mineOpen = mineTickets.filter(isOpen).slice(0, LIST_CAP)
  // Recently done: RESOLVED or CLOSED, most-recently-updated first.
  const recentlyDone = allTickets
    .filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, RECENT_CAP)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{openCount}</span> open{' '}
          {openCount === 1 ? 'ticket' : 'tickets'} need attention
        </p>
      </div>

      {/* Status summary strip — one card per key status, linking to the filtered inbox. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STRIP_STATUSES.map((status) => (
          <Link
            key={status}
            href={`/tickets?status=${status}`}
            className="flex flex-col gap-1 rounded-lg border p-3 hover:bg-accent"
          >
            <span className="text-2xl font-semibold tabular-nums">{counts[status] ?? 0}</span>
            <span className="text-xs text-muted-foreground">{status.replace(/_/g, ' ')}</span>
          </Link>
        ))}
      </div>

      {/* Operational list widgets — curated triage queues, 2 columns on desktop. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TicketWidget
          title="Needs triage"
          subtitle="New, unhandled tickets."
          tickets={newTickets.slice(0, LIST_CAP)}
          propertyNames={propertyNames}
          emptyMessage="Nothing needs triage."
          viewAllHref="/tickets?status=NEW"
        />
        <TicketWidget
          title="Urgent open"
          subtitle="Urgent tickets still in play."
          tickets={urgentOpen}
          propertyNames={propertyNames}
          emptyMessage="No urgent tickets open."
          viewAllHref="/tickets?priority=URGENT"
        />
        <TicketWidget
          title="Waiting for info"
          subtitle="Blocked on a response."
          tickets={waitingTickets.slice(0, LIST_CAP)}
          propertyNames={propertyNames}
          emptyMessage="Nothing is waiting on info."
          viewAllHref="/tickets?status=WAITING_FOR_INFO"
        />
        <TicketWidget
          title="Assigned to me"
          subtitle="Your open queue."
          tickets={mineOpen}
          propertyNames={propertyNames}
          emptyMessage="Nothing assigned to you."
          viewAllHref="/tickets"
        />
        <TicketWidget
          title="Recently resolved"
          subtitle="Wrapped up lately."
          tickets={recentlyDone}
          propertyNames={propertyNames}
          emptyMessage="Nothing resolved yet."
          viewAllHref="/tickets?status=RESOLVED"
        />
      </div>
    </div>
  )
}

// A compact list widget: heading, a short ticket list (title link, priority + status
// badge, property, date), a per-widget empty state, and a "View all →" link to the
// corresponding filtered inbox. Read-only — no action controls (dashboard is triage
// links only; the accountant gets the same read-only overview).
function TicketWidget({
  title,
  subtitle,
  tickets,
  propertyNames,
  emptyMessage,
  viewAllHref,
}: {
  title: string
  subtitle: string
  tickets: Ticket[]
  propertyNames: Record<string, string>
  emptyMessage: string
  viewAllHref: string
}) {
  return (
    <section className="flex flex-col rounded-lg border">
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Link href={viewAllHref} className="text-xs font-medium text-primary hover:underline">
          View all →
        </Link>
      </div>

      {tickets.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 hover:bg-accent"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">{t.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {propertyNames[t.property_id] ?? '—'} · {formatDate(t.created_at)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <TicketPriorityBadge priority={t.priority} />
                  <TicketStatusBadge status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
