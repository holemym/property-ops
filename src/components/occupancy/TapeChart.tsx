import Link from 'next/link'
import { StatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { OccupancySegment, OccupancyState, DateWindow } from '@/lib/occupancy/timeline'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketPriority } from '@/types/domain'

// The read-only tape chart: a units × time grid. The left column holds unit labels
// (grouped under property sub-headers); the right area is a proportional time track
// spanning the window, with month gridlines across the top, occupancy spans colored by
// state, and open-ticket dots pinned by date. Everything is positioned by DATE PROPORTION
// over the half-open window [from, to): a date d maps to (d − from) / (to − from). Dates
// are ISO `YYYY-MM-DD`; we parse them as UTC midnight so positioning is timezone-stable
// and matches the timeline builder (which compares the same ISO strings lexically).

// --- geometry -------------------------------------------------------------------------

function toMs(isoDate: string): number {
  // Parse `YYYY-MM-DD` as UTC midnight — no local-timezone drift.
  return Date.parse(`${isoDate}T00:00:00Z`)
}

// Fraction (0..1) of `iso` across the window. Clamped so a span/marker that reaches or
// pokes past an edge stays inside the track.
function fractionOf(iso: string, fromMs: number, spanMs: number): number {
  const f = (toMs(iso) - fromMs) / spanMs
  return f < 0 ? 0 : f > 1 ? 1 : f
}

function pct(n: number): string {
  // Round to 2 dp — enough for pixel-accurate placement at full width, and keeps the
  // inline style strings short/stable.
  return `${Math.round(n * 10000) / 100}%`
}

// The month columns spanning the window: one entry per whole month from `from` up to
// (but not including) `to`. left% is the month's start fraction; each label sits at the
// top of the track. Derived from the window so it stays in sync with defaultWindow's
// 6-month default without hard-coding a count.
type MonthColumn = { key: string; label: string; leftPct: string }

function monthColumns(window: DateWindow, fromMs: number, spanMs: number): MonthColumn[] {
  const cols: MonthColumn[] = []
  const start = new Date(fromMs)
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  const endMs = toMs(window.to)
  // Walk month-by-month until we reach the window's end.
  for (let guard = 0; guard < 60; guard++) {
    const colStartMs = Date.UTC(year, month, 1)
    if (colStartMs >= endMs) break
    const iso = new Date(colStartMs).toISOString().slice(0, 10)
    cols.push({
      key: iso,
      label: new Date(colStartMs).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      leftPct: pct(fractionOf(iso, fromMs, spanMs)),
    })
    month += 1
    if (month > 11) {
      month = 0
      year += 1
    }
  }
  return cols
}

// --- state tones ----------------------------------------------------------------------

// Segment fill per occupancy state. Tints mirror the StatusBadge status tones
// (src/lib/status.ts: OCCUPIED→blue, VACANT→amber, MAINTENANCE→amber, BLOCKED→red) so the
// chart reads consistently with the badges elsewhere. MAINTENANCE is distinguished from
// VACANT by a subtle diagonal hatch (both amber) so out-of-service reads apart from empty.
const SEGMENT_TONE: Record<OccupancyState, string> = {
  OCCUPIED: 'bg-blue-100 text-blue-900 dark:bg-blue-500/25 dark:text-blue-200',
  VACANT: 'bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200',
  MAINTENANCE:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200 [background-image:repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(0,0,0,0.06)_5px,rgba(0,0,0,0.06)_7px)]',
  BLOCKED: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-200',
}

const SEGMENT_LABEL: Record<OccupancyState, string> = {
  OCCUPIED: 'Occupied',
  VACANT: 'Vacant',
  MAINTENANCE: 'Maintenance',
  BLOCKED: 'Blocked',
}

// Ticket marker dot color by priority (URGENT red, HIGH amber, else neutral).
const MARKER_TONE: Record<TicketPriority, string> = {
  URGENT: 'bg-red-500 ring-red-500/30',
  HIGH: 'bg-amber-500 ring-amber-500/30',
  NORMAL: 'bg-foreground/60 ring-foreground/15',
  LOW: 'bg-foreground/60 ring-foreground/15',
}

// --- types ----------------------------------------------------------------------------

export type UnitRow = {
  unit: Unit
  segments: OccupancySegment[]
  tickets: Ticket[]
}

export type PropertyGroup = {
  property: Property
  rows: UnitRow[]
}

// --- component ------------------------------------------------------------------------

// Left label column width — a CSS var so the header ruler and every row share one
// alignment origin.
const LABEL_COL = '11rem'

export function TapeChart({
  groups,
  window,
  todayIso,
}: {
  groups: PropertyGroup[]
  window: DateWindow
  todayIso: string
}) {
  const fromMs = toMs(window.from)
  const spanMs = toMs(window.to) - fromMs
  const months = monthColumns(window, fromMs, spanMs)
  // The "today" line only shows when today falls inside the window. We keep the raw
  // fraction (0..1) so the overlay can be offset past the label column via a CSS calc.
  const todayLeft = todayIso >= window.from && todayIso < window.to
  const todayFraction = todayLeft ? fractionOf(todayIso, fromMs, spanMs) : 0

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      {/* Horizontal scroll on narrow screens; the track keeps a comfortable min width. */}
      <div className="overflow-x-auto">
        <div className="relative min-w-[52rem]" style={{ ['--label-col' as string]: LABEL_COL }}>
          {/* "today" line — spans all rows, positioned inside the track (offset past the
              label column). Sits above the grid but below the ticket markers. */}
          {todayLeft && (
            <div
              className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-foreground/40"
              style={{ left: `calc(var(--label-col) + (100% - var(--label-col)) * ${todayFraction})` }}
              aria-hidden
            />
          )}
          {/* Month ruler */}
          <div className="flex items-stretch border-b">
            <div className="w-[var(--label-col)] shrink-0 px-4 py-2 text-xs font-medium text-muted-foreground">
              Unit
            </div>
            <div className="relative flex-1 py-2">
              {months.map((m) => (
                <div
                  key={m.key}
                  className="absolute top-0 flex h-full items-center border-l border-border/70 pl-1.5 text-xs font-medium text-muted-foreground"
                  style={{ left: m.leftPct }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* Property groups → unit rows */}
          {groups.map((group) => (
            <div key={group.property.id}>
              <div className="flex items-center border-b bg-muted/40">
                <div className="w-[var(--label-col)] shrink-0 px-4 py-1.5 text-xs font-semibold tracking-tight text-foreground">
                  {group.property.name}
                </div>
                <div className="flex-1" />
              </div>

              {group.rows.map((row) => (
                <div key={row.unit.id} className="flex items-stretch border-b last:border-b-0">
                  <div className="w-[var(--label-col)] shrink-0 px-4 py-2.5">
                    <div className="truncate text-sm font-medium text-foreground">
                      {row.unit.label}
                    </div>
                    {row.unit.floor && (
                      <div className="truncate text-xs text-muted-foreground">
                        Floor {row.unit.floor}
                      </div>
                    )}
                  </div>

                  <div className="relative min-h-[3.25rem] flex-1 py-2.5">
                    {/* Month gridlines behind the spans */}
                    {months.map((m) => (
                      <div
                        key={m.key}
                        className="absolute inset-y-0 w-px bg-border/60"
                        style={{ left: m.leftPct }}
                        aria-hidden
                      />
                    ))}

                    {/* Occupancy spans */}
                    <div className="absolute inset-x-0 top-2.5 bottom-2.5">
                      {row.segments.map((seg, i) => {
                        const left = fractionOf(seg.from, fromMs, spanMs)
                        const right = fractionOf(seg.to, fromMs, spanMs)
                        const width = right - left
                        if (width <= 0) return null
                        const showName = seg.state === 'OCCUPIED' && seg.tenantName && width > 0.06
                        return (
                          <div
                            key={`${seg.from}-${i}`}
                            className={cn(
                              'absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-xs font-medium',
                              SEGMENT_TONE[seg.state]
                            )}
                            style={{ left: pct(left), width: pct(width) }}
                            title={
                              seg.state === 'OCCUPIED' && seg.tenantName
                                ? `${seg.tenantName} · ${SEGMENT_LABEL[seg.state]}`
                                : SEGMENT_LABEL[seg.state]
                            }
                          >
                            <span className="truncate">
                              {showName ? seg.tenantName : ''}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {/* Open-ticket markers */}
                    {row.tickets.map((ticket) => {
                      const dateIso = (ticket.scheduled_at ?? ticket.created_at).slice(0, 10)
                      if (dateIso < window.from || dateIso >= window.to) return null
                      const left = pct(fractionOf(dateIso, fromMs, spanMs))
                      return (
                        <TicketMarker key={ticket.id} ticket={ticket} left={left} />
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// A single open-ticket marker: a priority-colored dot on the track with a group-hover
// preview card, wrapped in a link to the ticket. Keyboard-focusable and labelled.
function TicketMarker({ ticket, left }: { ticket: Ticket; left: string }) {
  return (
    <div className="group/marker absolute top-1/2 z-10 -translate-y-1/2" style={{ left }}>
      <Link
        href={`/tickets/${ticket.id}`}
        aria-label={`Ticket: ${ticket.title} (${ticket.priority.toLowerCase()} priority)`}
        className="block -translate-x-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            'block size-2.5 rounded-full ring-2 ring-offset-1 ring-offset-card',
            MARKER_TONE[ticket.priority]
          )}
        />
      </Link>
      {/* Hover/focus preview — a lightweight popover. group-hover + focus-within so it
          appears on both pointer hover and keyboard focus of the link. */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-lg bg-popover p-2.5 text-popover-foreground ring-1 ring-foreground/10 group-hover/marker:block group-focus-within/marker:block">
        <div className="truncate text-sm font-medium">{ticket.title}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <StatusBadge kind="ticket_status" value={ticket.status} />
          <StatusBadge kind="ticket_priority" value={ticket.priority} />
        </div>
      </div>
    </div>
  )
}

