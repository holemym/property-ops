import { formatDateTime } from '@/lib/format-date'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Building2, Inbox } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { can, isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets, countTicketsByStatus, type Ticket } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { getSetupProgress } from '@/lib/data/setup'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { DashboardMfaNag } from '@/components/dashboard/DashboardMfaNag'
import { SetupChecklist } from '@/components/dashboard/SetupChecklist'
import { cn } from '@/lib/utils'
import { relativeDay } from '@/lib/relative-date'
import { isTicketOpen } from '@/lib/status'
import type { TicketStatus } from '@/types/domain'

// Per-widget cap — the dashboard shows short curated slices, not the full inbox. Each
// list links to the filtered inbox ("View all") for the complete set.
const LIST_CAP = 8
const RECENT_CAP = 6

// The status cards shown in the top strip, in operational reading order.
const STRIP_STATUSES: TicketStatus[] = [
  'NEW',
  'TRIAGE',
  'WAITING_FOR_INFO',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
]

const STRIP_LABELS: Record<TicketStatus, string> = {
  NEW: 'New',
  TRIAGE: 'Triage',
  WAITING_FOR_INFO: 'Waiting',
  ASSIGNED: 'Assigned',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

// Aging tone for an open ticket's age — amber past 3 days, red past 7, so a queue that's
// piling up reads at a glance ("nothing slips").
function agingTone(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days > 7) return 'text-red-600 dark:text-red-400 font-medium'
  if (days > 3) return 'text-amber-700 dark:text-amber-400'
  return 'text-muted-foreground'
}

export default async function DashboardPage() {
  // Tenants/guests have no operator dashboard — land them on their portal's My Home
  // surface instead (Phase 1B's real landing page, superseding the plain /portal ticket
  // list this redirect used pre-1B). Managers/OWNER/SUPER_ADMIN/ACCOUNTANT stay.
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal/home')

  const supabase = await createClient()
  // A handful of curated slices + one status tally + the property name map, all in
  // parallel (not N+1). RLS scopes every query to this workspace. listTickets has no
  // server-side LIMIT today (Phase-4 optimization), so widgets slice in JS below;
  // workspace ticket volume is bounded at MVP scale.
  const [counts, allTickets, properties, mfaFactors, setupProgress] = await Promise.all([
    countTicketsByStatus(supabase, user.workspaceId),
    // ONE workspace ticket read; every widget slice below derives from it in JS.
    // (The old version issued four extra filtered listTickets calls whose results
    // were all strict subsets of this one — 7 queries where 3 do.) listTickets has
    // no server-side LIMIT today (Phase-4 optimization); volume is bounded at MVP
    // scale and the filters were plain .eq()s, so JS-filtering preserves both the
    // rows and the created_at-desc order exactly.
    listTickets(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
    // mfa.listFactors() reaches the auth server; `.catch` isolates it so a transient
    // auth hiccup can't 500 the app's main landing page — same fail-safe as before,
    // now in the batch instead of a serialized follow-up await.
    supabase.auth.mfa.listFactors().catch(() => null),
    // Three head-only counts feeding the "Finish setting up" checklist below.
    getSetupProgress(supabase, user.workspaceId),
  ])
  const newTickets = allTickets.filter((t) => t.status === 'NEW')
  const urgentTickets = allTickets.filter((t) => t.priority === 'URGENT')
  const waitingTickets = allTickets.filter((t) => t.status === 'WAITING_FOR_INFO')
  const mineTickets = allTickets.filter((t) => t.assigned_operator_id === user.id)

  // Soft enforcement: OWNER/SUPER_ADMIN with no verified TOTP factor sees a dismissible
  // nag pointing at /settings/security. Fails safe to "no nag" (never a false nag,
  // never a 500) when the factors read errored.
  const hasVerifiedMfaFactor =
    mfaFactors === null || (mfaFactors.data?.totp ?? []).some((f) => f.status === 'verified')
  const showMfaNag = (user.role === 'OWNER' || user.role === 'SUPER_ADMIN') && !hasVerifiedMfaFactor

  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))

  // "Open" headline = every non-terminal ticket (sum of all statuses except
  // RESOLVED/CLOSED/CANCELLED — isTicketOpen is the single source of truth, shared with
  // occupancy/insights/property-hub/unit-hub/map so the same ticket reads the same way
  // everywhere).
  const openCount = Object.entries(counts).reduce(
    (sum, [status, n]) => (isTicketOpen(status as TicketStatus) ? sum + (n ?? 0) : sum),
    0
  )

  // Urgent fires: URGENT and still non-terminal. listTickets is newest-first already.
  const urgentOpen = urgentTickets.filter((t) => isTicketOpen(t.status)).slice(0, LIST_CAP)
  // My queue: assigned to me and still non-terminal.
  const mineOpen = mineTickets.filter((t) => isTicketOpen(t.status)).slice(0, LIST_CAP)
  // Recently done: RESOLVED or CLOSED, most-recently-updated first.
  const recentlyDone = allTickets
    .filter((t) => t.status === 'RESOLVED' || t.status === 'CLOSED')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, RECENT_CAP)

  // A brand-new workspace has no ACTIVE properties, so a ticket-only dashboard is six
  // zero cards and five empty widgets with NO path to the first real action. Show the
  // setup chain instead — the single biggest new-owner strand the flow review found.
  // ACTIVE (not all): an owner who archives their only property is back at square one
  // and gets the guidance again, not the empty ticket dashboard.
  const activeProperties = properties.filter((p) => p.status === 'ACTIVE')
  // After the first property, the checklist card carries the remaining chain (units →
  // tenancies → residents) until each has data; ACCOUNTANT can't act on any step and
  // never sees it. Same gate as the zero-state CTA.
  const showChecklist =
    can(user.role, 'properties:write') &&
    activeProperties.length > 0 &&
    (setupProgress.units === 0 ||
      setupProgress.tenancies === 0 ||
      setupProgress.invitedResidents === 0)

  if (activeProperties.length === 0) {
    return (
      <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[--duration-fast]">
        <PageHeader title="Dashboard" subtitle="Let's set up your portfolio." />
        {showMfaNag && <DashboardMfaNag />}
        <EmptyState
          icon={<Building2 />}
          title="Set up your portfolio"
          body="Start with a property, add its units, record tenancies, then invite residents to the portal — everything else (tickets, rent, statements) builds on those."
          action={
            can(user.role, 'properties:write') ? (
              <Button render={<Link href="/properties/new" />} nativeButton={false}>
                Add your first property
              </Button>
            ) : undefined
          }
        />
      </div>
    )
  }

  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[--duration-fast]">
      <PageHeader
        title="Dashboard"
        subtitle={`${openCount} open ${openCount === 1 ? 'ticket' : 'tickets'} across the portfolio`}
      />

      {showMfaNag && <DashboardMfaNag />}

      {showChecklist && <SetupChecklist progress={setupProgress} />}

      {/* Status summary strip — one graphite metric card per key status, linking to the
          filtered inbox. Saturated color stays out of these; the counts read as data. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STRIP_STATUSES.map((status) => (
          <Link
            key={status}
            href={`/tickets?status=${status}`}
            className="group flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors duration-[--duration-fast] ease-[--ease-out] hover:border-foreground/20 hover:bg-accent"
          >
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {counts[status] ?? 0}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {STRIP_LABELS[status]}
            </span>
          </Link>
        ))}
      </div>

      {/* Operational list widgets — curated triage queues, 2 columns on desktop. */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TicketWidget
          title="Needs triage"
          subtitle="New, unhandled tickets"
          tickets={newTickets.slice(0, LIST_CAP)}
          propertyNames={propertyNames}
          emptyMessage="Nothing needs triage right now."
          viewAllHref="/tickets?status=NEW"
        />
        <TicketWidget
          title="Urgent open"
          subtitle="Urgent tickets still in play"
          tickets={urgentOpen}
          propertyNames={propertyNames}
          emptyMessage="No urgent tickets are open."
          viewAllHref="/tickets?priority=URGENT"
        />
        <TicketWidget
          title="Waiting for info"
          subtitle="Blocked on a response"
          tickets={waitingTickets.slice(0, LIST_CAP)}
          propertyNames={propertyNames}
          emptyMessage="Nothing is waiting on info."
          viewAllHref="/tickets?status=WAITING_FOR_INFO"
        />
        <TicketWidget
          title="Assigned to me"
          subtitle="Your open queue"
          tickets={mineOpen}
          propertyNames={propertyNames}
          emptyMessage="Nothing is assigned to you."
          viewAllHref="/tickets"
        />
        <TicketWidget
          title="Recently resolved"
          subtitle="Wrapped up lately"
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
// badge, property, date), a per-widget empty state, and a "View all" link to the
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
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Link
          href={viewAllHref}
          className="group inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          View all
          <ArrowRight className="size-3 transition-transform duration-[--duration-fast] ease-[--ease-out] group-hover:translate-x-0.5" />
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <Inbox className="size-5 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 transition-colors duration-[--duration-fast] ease-[--ease-out] hover:bg-accent"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {propertyNames[t.property_id] ?? '—'} ·{' '}
                    <span className={cn(agingTone(t.created_at))} title={formatDateTime(t.created_at)}>
                      {relativeDay(t.created_at)}
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <StatusBadge kind="ticket_priority" value={t.priority} />
                  <StatusBadge kind="ticket_status" value={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
