import { CalendarClock } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTenancies } from '@/lib/data/tenancies'
import { listTickets } from '@/lib/data/tickets'
import { buildUnitTimeline, defaultWindow } from '@/lib/occupancy/timeline'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketStatus } from '@/types/domain'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { TapeChart, type PropertyGroup } from '@/components/occupancy/TapeChart'
import { NewTenancyDialog } from '@/components/occupancy/NewTenancyDialog'
import { createTenancyAction } from './actions'

// Terminal ticket states — a ticket in one of these is "done" and doesn't belong on the
// live occupancy overlay. Everything else counts as OPEN and gets pinned as a marker.
const TERMINAL_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED']

function isOpen(ticket: Ticket): boolean {
  return !TERMINAL_STATUSES.includes(ticket.status)
}

export default async function OccupancyPage() {
  const user = await requirePermission('occupancy:read')
  const canWrite = can(user.role, 'units:write')

  const supabase = await createClient()
  const [properties, units, tenancies, tickets] = await Promise.all([
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
    // Fetch all workspace tickets and filter to non-terminal in-page — listTickets takes
    // a single-status filter, and we want every open status, not one.
    listTickets(supabase, user.workspaceId),
  ])

  const timelineWindow = defaultWindow(new Date())
  const todayIso = new Date().toISOString().slice(0, 10)

  const openTickets = tickets.filter(isOpen)

  // Group units under their property, computing each unit's timeline + open tickets.
  // Properties come newest-first; we keep that order and only surface properties that
  // actually hold units, so the chart isn't padded with empty groups.
  const groups: PropertyGroup[] = properties
    .map((property) => ({
      property,
      rows: units
        .filter((unit) => unit.property_id === property.id)
        .map((unit) => ({
          unit,
          segments: buildUnitTimeline(
            unit.status,
            tenancies.filter((t) => t.unit_id === unit.id),
            timelineWindow
          ),
          tickets: openTickets.filter((t) => t.unit_id === unit.id),
        })),
    }))
    .filter((group) => group.rows.length > 0)

  // Flat unit list for the "New tenancy" unit select, labelled with property context.
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitOptions = units.map((u) => ({
    id: u.id,
    label: u.label,
    propertyName: propertyName.get(u.property_id) ?? 'Unknown property',
  }))

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader
        title="Occupancy"
        subtitle="Unit availability across the portfolio, in preview."
        actions={
          canWrite && unitOptions.length > 0 ? (
            <NewTenancyDialog action={createTenancyAction} units={unitOptions} />
          ) : undefined
        }
      />

      {units.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No units to chart yet"
          body="Add units to a property, then record tenancies to see occupancy spans across the months ahead."
        />
      ) : (
        <>
          <TapeChart groups={groups} window={timelineWindow} todayIso={todayIso} />
          <Legend />
        </>
      )}
    </div>
  )
}

// A compact key for the segment tones + ticket markers. Read-only "preview" note lives
// here so the header stays clean.
function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
      <LegendSwatch className="bg-blue-100 dark:bg-blue-500/25" label="Occupied" />
      <LegendSwatch className="bg-amber-50 dark:bg-amber-500/10" label="Vacant" />
      <LegendSwatch className="bg-amber-100 dark:bg-amber-500/25" label="Maintenance" />
      <LegendSwatch className="bg-red-100 dark:bg-red-500/25" label="Blocked" />
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-full bg-foreground/60" aria-hidden />
        Open ticket
      </span>
      <span className="ml-auto">Read-only preview</span>
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-3 rounded-sm ${className}`} aria-hidden />
      {label}
    </span>
  )
}
