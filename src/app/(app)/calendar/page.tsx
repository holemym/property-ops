import Link from 'next/link'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listTickets } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'
import { listUnits } from '@/lib/data/units'
import { listProperties } from '@/lib/data/properties'
import { listDocuments } from '@/lib/data/documents'
import { statusBadge } from '@/lib/status'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { MonthGrid } from '@/components/calendar/MonthGrid'
import {
  buildMonthGrid,
  currentMonth,
  gridBounds,
  monthLabel,
  nextMonthParam,
  parseMonthParam,
  prevMonthParam,
  toMonthParam,
} from '@/components/calendar/month'
import {
  KIND_STYLES,
  bucketByDay,
  type CalendarEvent,
  type CalendarEventKind,
} from '@/components/calendar/events'
import type { DocumentType } from '@/types/domain'

// Friendly labels for the document-expiry chip suffix (title-cased from the enum).
const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  LEASE: 'Lease',
  CONTRACT: 'Contract',
  PERMIT: 'Permit',
  CERTIFICATE: 'Certificate',
  INSURANCE: 'Insurance',
  ID: 'ID',
  INVOICE: 'Invoice',
  OTHER: 'Document',
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requirePermission('tickets:read')
  const { month: rawMonth } = await searchParams

  // Resolve the anchor month: a valid ?month=YYYY-MM, else the current month (UTC).
  const anchor = parseMonthParam(rawMonth) ?? currentMonth(new Date())
  const { year, month0 } = anchor

  const days = buildMonthGrid(year, month0)
  const { from, to } = gridBounds(year, month0)
  const todayIso = new Date().toISOString().slice(0, 10)

  const supabase = await createClient()
  const [tickets, tenancies, documents, units, properties] = await Promise.all([
    listTickets(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
    listDocuments(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
  ])

  // Label lookups. A unit is shown as "Property · Unit" where the property is known.
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitLabel = new Map(
    units.map((u) => {
      const prop = propertyName.get(u.property_id)
      return [u.id, prop ? `${prop} · ${u.label}` : u.label]
    }),
  )

  // A day is inside the visible grid when from <= iso < to (lexicographic on YYYY-MM-DD).
  const inWindow = (iso: string) => iso >= from && iso < to

  const events: CalendarEvent[] = []

  // Scheduled tickets → blue chips on their scheduled day, linking to the detail page.
  for (const t of tickets) {
    if (!t.scheduled_at) continue
    const date = t.scheduled_at.slice(0, 10)
    if (!inWindow(date)) continue
    events.push({
      date,
      kind: 'ticket',
      label: t.title,
      meta: statusBadge('ticket_priority', t.priority).label,
      href: `/tickets/${t.id}`,
    })
  }

  // Tenancies → a move-in chip on start_date and a move-out chip on end_date (if set).
  for (const ten of tenancies) {
    const where = unitLabel.get(ten.unit_id) ?? 'Unit'
    const start = ten.start_date.slice(0, 10)
    if (inWindow(start)) {
      events.push({ date: start, kind: 'move-in', label: ten.tenant_name, meta: where })
    }
    if (ten.end_date) {
      const end = ten.end_date.slice(0, 10)
      if (inWindow(end)) {
        events.push({ date: end, kind: 'move-out', label: ten.tenant_name, meta: where })
      }
    }
  }

  // Documents → an expiry chip on expires_at (if set), labelled title + type.
  for (const doc of documents) {
    if (!doc.expires_at) continue
    const date = doc.expires_at.slice(0, 10)
    if (!inWindow(date)) continue
    events.push({
      date,
      kind: 'doc-expiry',
      label: doc.title,
      meta: DOC_TYPE_LABELS[doc.document_type],
    })
  }

  const eventsByDay = bucketByDay(events)
  const thisMonthParam = toMonthParam(currentMonth(new Date()).year, currentMonth(new Date()).month0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        subtitle="Scheduled work, lease moves, and document expiries across the month."
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Previous month"
              render={<Link href={`/calendar?month=${prevMonthParam(year, month0)}`} />}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/calendar?month=${thisMonthParam}`} />}
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Next month"
              render={<Link href={`/calendar?month=${nextMonthParam(year, month0)}`} />}
            >
              <ChevronRight />
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-foreground">{monthLabel(year, month0)}</h2>
        <Legend />
      </div>

      {events.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          <CalendarDays className="size-4 shrink-0" />
          Nothing scheduled this month — future work and expiries will show up here.
        </div>
      )}

      <MonthGrid days={days} eventsByDay={eventsByDay} todayIso={todayIso} />
    </div>
  )
}

// Compact key for the four event tones, mirroring the chip colors in the grid.
function Legend() {
  const items: { kind: CalendarEventKind; label: string }[] = [
    { kind: 'ticket', label: 'Scheduled ticket' },
    { kind: 'move-in', label: 'Move-in' },
    { kind: 'move-out', label: 'Move-out' },
    { kind: 'doc-expiry', label: 'Document expiry' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(({ kind, label }) => (
        <span key={kind} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${KIND_STYLES[kind].dot}`} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  )
}
