import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { can, type Permission } from '@/lib/auth/permissions'
import type { GuideState } from '@/lib/data/guide'
import { StatusBadge } from '@/components/ui/badge'
import { RequestProgress } from '@/components/portal/RequestProgress'
import { Path, type GuideStateLine, type GuideStep } from '@/components/guide/GuideChapter'
import type { InvoiceStatus, Role, TicketStatus } from '@/types/domain'

// The /guide chapters, one set per audience. Pure (state in, chapters out) so the
// permission filtering is unit-tested and the page stays a thin data fetch. Rule: a
// change to what the app does updates these chapters in the same commit.

export type Chapter = {
  id: string
  title: string
  purpose: string
  state?: GuideStateLine
  specimen?: ReactNode
  steps: (GuideStep & { permission?: Permission })[]
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

const TICKET_FLOW: TicketStatus[] = ['NEW', 'TRIAGE', 'ASSIGNED', 'SCHEDULED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const INVOICE_FLOW: InvoiceStatus[] = ['DRAFT', 'SENT', 'PAID']

// A status lifecycle drawn with the app's own badges; each stage opens the list filtered
// to it, with the workspace's live count.
function Lifecycle({ items }: { items: { key: string; badge: ReactNode; count: number; href: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((it, i) => (
        <Fragment key={it.key}>
          {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
          <Link
            href={it.href}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-[--duration-fast] hover:bg-accent"
          >
            {it.badge}
            <span className="tabular-nums text-xs text-muted-foreground">{it.count}</span>
          </Link>
        </Fragment>
      ))}
    </div>
  )
}

export function operatorChapters(s: GuideState): Chapter[] {
  const openTickets = TICKET_FLOW.filter((t) => t !== 'RESOLVED' && t !== 'CLOSED').reduce(
    (sum, t) => sum + (s.tickets[t] ?? 0),
    s.tickets.WAITING_FOR_INFO ?? 0
  )
  const invoiceTotal = INVOICE_FLOW.reduce((sum, t) => sum + (s.invoices[t] ?? 0), 0)

  return [
    {
      id: 'portfolio',
      title: 'Properties and units',
      purpose: 'Everything else hangs off a property and its units: tenancies, tickets, invoices, documents.',
      state: {
        done: s.properties > 0 && s.units > 0,
        line:
          `${n(s.properties, 'property', 'properties')} · ${n(s.units, 'unit')}` +
          (s.propertiesWithoutLocation > 0 ? ` · ${s.propertiesWithoutLocation} not on the map yet` : ''),
        href: s.propertiesWithoutLocation > 0 ? '/map' : '/properties',
      },
      steps: [
        {
          text: 'Add a property with its full street address. It appears on the Map on its own.',
          href: '/properties/new',
          cta: 'Add a property',
          permission: 'properties:write',
        },
        {
          text: 'Add the units: label, floor and usable area in m².',
          href: s.firstPropertyId ? `/units/new?propertyId=${s.firstPropertyId}` : '/units/new',
          cta: 'Add a unit',
          permission: 'units:write',
        },
        {
          text: (
            <>
              A property without a pin: <Path>Map → Locate missing</Path>.
            </>
          ),
          href: '/map',
          cta: 'Open the map',
          permission: 'properties:read',
        },
      ],
    },
    {
      id: 'residents',
      title: 'Residents and tenancies',
      purpose: 'A tenancy records who lives in a unit, from when, and at what rent.',
      state: {
        done: s.tenancies > 0,
        line: `${n(s.people, 'person', 'people')} · ${n(s.tenancies, 'tenancy', 'tenancies')}`,
        href: '/occupancy',
      },
      steps: [
        {
          text: 'Add each resident under People. Include an email if they should use the resident portal.',
          href: '/people/new',
          cta: 'Add a person',
          permission: 'tenants:write',
        },
        {
          text: (
            <>
              On the unit&apos;s page: <Path>Tenancy history → New tenancy</Path>. Pick the person, so
              their rent charges reach their portal.
            </>
          ),
          href: '/units',
          cta: 'Open units',
          permission: 'units:read',
        },
        {
          text: (
            <>
              To end a tenancy, open it with <Path>Edit</Path> and use <Path>End tenancy</Path>. Two
              tenancies on one unit cannot overlap.
            </>
          ),
          href: '/occupancy',
          cta: 'Open occupancy',
          permission: 'occupancy:read',
        },
      ],
    },
    {
      id: 'portal',
      title: 'The resident portal',
      purpose: 'Residents report issues, follow them, and see their charges, documents and notices.',
      state: {
        done: s.invitedResidents > 0,
        line: `${n(s.invitedResidents, 'resident')} can sign in to the portal`,
        href: '/people',
      },
      steps: [
        {
          text: (
            <>
              <Path>People → the resident → Portal access → Invite to portal</Path>. They get an email,
              set a password and land on their Home.
            </>
          ),
          href: '/people',
          cta: 'Open People',
          // Inviting is admin-only; admins also hold tenants:read for the link itself.
          permission: 'users:invite',
        },
        {
          text: 'Someone who already has an account is attached without a new email. Send them the sign-in page.',
        },
        {
          text: 'Their requests arrive as New tickets, and you get a notification.',
          href: '/tickets?status=NEW',
          cta: 'New tickets',
          permission: 'tickets:read',
        },
      ],
    },
    {
      id: 'tickets',
      title: 'Maintenance tickets',
      purpose: 'Each repair moves through the same stages; click a stage to open those tickets.',
      // No done-check here: "no open tickets" is an empty inbox, not a finished setup step.
      state: { line: n(openTickets, 'open ticket'), href: '/tickets' },
      specimen: (
        <Lifecycle
          items={TICKET_FLOW.map((t) => ({
            key: t,
            badge: <StatusBadge kind="ticket_status" value={t} />,
            count: s.tickets[t] ?? 0,
            href: `/tickets?status=${t}`,
          }))}
        />
      ),
      steps: [
        {
          text: 'Open a ticket from Tickets, or from a property or unit page so the place is filled in.',
          href: '/tickets/new',
          cta: 'New ticket',
          permission: 'tickets:write',
        },
        {
          text: 'Assign an operator or a vendor, then schedule the visit. Scheduled tickets appear in the Calendar.',
          href: '/calendar',
          cta: 'Open calendar',
          permission: 'tickets:read',
        },
        {
          text: (
            <>
              A vendor gets a job link from the ticket page (<Path>Generate job link</Path>) and accepts and
              completes the job without an account.
            </>
          ),
          href: '/vendors',
          cta: 'Open vendors',
          permission: 'vendors:read',
        },
        {
          text: 'Public comments reach the resident; internal comments stay with staff. The Board moves tickets by drag.',
          href: '/tickets/board',
          cta: 'Open board',
          permission: 'tickets:read',
        },
      ],
    },
    {
      id: 'rent',
      title: 'Rent and invoices',
      purpose: 'Rent invoices are drafted from tenancies, then sent and marked paid.',
      state: { done: invoiceTotal > 0, line: n(invoiceTotal, 'invoice'), href: '/invoices' },
      specimen: (
        <Lifecycle
          items={INVOICE_FLOW.map((t) => ({
            key: t,
            badge: <StatusBadge kind="invoice_status" value={t} />,
            count: s.invoices[t] ?? 0,
            href: `/invoices?status=${t}`,
          }))}
        />
      ),
      steps: [
        {
          text: (
            <>
              <Path>Invoices → Generate rent</Path>, pick the month: one draft per tenancy with rent. A month
              already billed is skipped, so running it twice is safe.
            </>
          ),
          href: '/invoices',
          cta: 'Open invoices',
          permission: 'finance:read',
        },
        {
          text: 'Check the drafts, send them, and mark each paid when the money arrives. Past the due date they show as overdue.',
          href: '/invoices?overdue=1',
          cta: 'Overdue',
          permission: 'finance:read',
        },
        {
          text: 'Owner statements group invoices per owner and currency, to print or export as CSV.',
          href: '/owners',
          cta: 'Open owners',
          permission: 'finance:read',
        },
        {
          text: 'Finance keeps income and expenses; Insights shows trends across the portfolio.',
          href: '/insights',
          cta: 'Open insights',
          permission: 'analytics:read',
        },
      ],
    },
    {
      id: 'records',
      title: 'Documents and announcements',
      purpose: 'Files and notices, shared with residents only where you choose.',
      state: {
        done: s.documents > 0 || s.announcements > 0,
        line: `${n(s.documents, 'document')} · ${n(s.announcements, 'announcement')}`,
        href: '/documents',
      },
      steps: [
        {
          text: (
            <>
              Upload a document and attach it to a property, unit or tenancy. <Path>Resident-visible</Path>{' '}
              marks what residents can open.
            </>
          ),
          href: '/documents',
          cta: 'Open documents',
          permission: 'documents:read',
        },
        {
          text: 'Write an announcement as a draft, then publish it. Residents it applies to get a notification.',
          href: '/announcements',
          cta: 'Open announcements',
          permission: 'announcements:read',
        },
      ],
    },
    {
      id: 'team',
      title: 'Team and account',
      purpose: 'Who works in this workspace, and how each person signs in.',
      steps: [
        {
          text: (
            <>
              <Path>Settings → Users</Path>: invite staff as Operator, Accountant or Owner.
            </>
          ),
          href: '/settings/users',
          cta: 'Open users',
          permission: 'users:invite',
        },
        {
          text: (
            <>
              <Path>Settings → Security</Path>: two-factor sign-in and your password.
            </>
          ),
          href: '/settings/security',
          cta: 'Open security',
        },
        {
          text: (
            <>
              Jump to any screen or record with <Path>Ctrl K</Path> (<Path>⌘ K</Path> on a Mac). The bell
              collects assignments, status changes and replies.
            </>
          ),
          href: '/notifications',
          cta: 'Notifications',
        },
      ],
    },
  ]
}

export const RESIDENT_CHAPTERS: Chapter[] = [
  {
    id: 'home',
    title: 'Your home',
    purpose: 'Your tenancy, rent and lease dates, and who manages the building.',
    steps: [{ text: 'Home is where you land after signing in.', href: '/portal/home', cta: 'Open Home' }],
  },
  {
    id: 'report',
    title: 'Report an issue',
    purpose: 'A broken tap, a heating fault, a lock: anything that needs the property manager.',
    steps: [
      { text: 'Choose where the problem is, describe it, and send.', href: '/portal/new', cta: 'Report an issue' },
      { text: "On the request's page, add photos so the manager can see the problem." },
    ],
  },
  {
    id: 'follow',
    title: 'Follow your requests',
    purpose: 'Every request shows how far along it is.',
    specimen: (
      <div className="max-w-md rounded-xl border bg-card p-4">
        <RequestProgress status="SCHEDULED" />
      </div>
    ),
    steps: [
      { text: 'Open a request to see its progress and the conversation.', href: '/portal', cta: 'My requests' },
      { text: 'Reply in the request. Answers from the manager appear there and under the bell.' },
    ],
  },
  {
    id: 'charges',
    title: 'Charges',
    purpose: 'Rent and other charges, with due dates and whether they are paid.',
    steps: [{ text: 'Open My charges to see each charge and its status.', href: '/portal/charges', cta: 'My charges' }],
  },
  {
    id: 'records',
    title: 'Documents and notices',
    purpose: 'Files the manager shared with you, and notices for your building.',
    steps: [
      { text: 'Your lease and other shared files.', href: '/portal/documents', cta: 'My documents' },
      { text: 'Building notices. New ones also arrive under the bell.', href: '/portal/announcements', cta: 'Announcements' },
    ],
  },
  {
    id: 'account',
    title: 'Your account',
    purpose: 'Your password and signing in.',
    steps: [
      {
        text: (
          <>
            Change your password from the account menu, top right: <Path>Change password</Path>.
          </>
        ),
        href: '/auth/set-password',
        cta: 'Change password',
      },
      {
        text: (
          <>
            Forgot it? On the sign-in page, <Path>Forgot password?</Path> sends a reset link.
          </>
        ),
      },
    ],
  },
]

export type NumberedChapter = Chapter & { number: string }

// Never link a role into a screen it can't open; a chapter left with nothing to do for
// this role is dropped, and the survivors are numbered in order.
export function visibleChapters(chapters: Chapter[], role: Role): NumberedChapter[] {
  return chapters
    .map((c) => ({ ...c, steps: c.steps.filter((s) => !s.permission || can(role, s.permission)) }))
    .filter((c) => c.steps.length > 0)
    .map((c, i) => ({ ...c, number: String(i + 1).padStart(2, '0') }))
}
