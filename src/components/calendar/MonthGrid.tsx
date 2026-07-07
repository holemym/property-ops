import Link from 'next/link'
import { cn } from '@/lib/utils'
import { WEEKDAY_LABELS, type CalendarDay } from './month'
import { KIND_STYLES, type CalendarEvent, type CalendarEventKind } from './events'

// How many event chips a cell shows before collapsing the rest into a "+N more" line.
const MAX_CHIPS = 3

// The kinds shown in the legend, in reading order (matches the chip tones).
const LEGEND_KINDS: CalendarEventKind[] = ['ticket', 'move-in', 'move-out', 'doc-expiry']

// Full-text label for an event, used as the native tooltip on chips + the day peek.
function eventText(event: CalendarEvent): string {
  return event.meta ? `${event.label} · ${event.meta}` : event.label
}

export function MonthGrid({
  days,
  eventsByDay,
  todayIso,
}: {
  days: CalendarDay[]
  eventsByDay: Map<string, CalendarEvent[]>
  todayIso: string
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      {/* Weekday header row (Monday-first). */}
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            <span className="hidden sm:inline">{label}</span>
            <span className="sm:hidden">{label.slice(0, 1)}</span>
          </div>
        ))}
      </div>

      {/* 6 weeks × 7 days. Borders form the grid; the last row/col trim their own. */}
      <div className="grid grid-cols-7">
        {days.map((cell, i) => {
          const events = eventsByDay.get(cell.iso) ?? []
          const isToday = cell.iso === todayIso
          const shown = events.slice(0, MAX_CHIPS)
          const overflow = events.length - shown.length
          // Trim the trailing border on the last column and the bottom row (rows of 7).
          const lastCol = (i + 1) % 7 === 0
          const lastRow = i >= days.length - 7

          return (
            <div
              key={cell.iso}
              className={cn(
                'min-h-24 border-b border-r p-1.5 transition-colors sm:min-h-28',
                lastCol && 'border-r-0',
                lastRow && 'border-b-0',
                cell.inMonth ? 'hover:bg-muted/30' : 'bg-muted/30',
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums',
                    cell.inMonth ? 'text-foreground' : 'text-muted-foreground/60',
                    isToday && 'bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {cell.day}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                {shown.map((event, j) => (
                  <EventChip key={`${cell.iso}-${j}`} event={event} />
                ))}
                {overflow > 0 && (
                  // The remaining events are surfaced as a native tooltip (escapes the
                  // grid's overflow clip, unlike an absolute popover).
                  <span
                    className="cursor-default px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    title={events.slice(MAX_CHIPS).map(eventText).join('\n')}
                  >
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend — what each chip colour means. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2.5 text-xs text-muted-foreground">
        {LEGEND_KINDS.map((kind) => (
          <span key={kind} className="flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', KIND_STYLES[kind].dot)} aria-hidden />
            {KIND_STYLES[kind].label}
          </span>
        ))}
      </div>
    </div>
  )
}

function EventChip({ event }: { event: CalendarEvent }) {
  const styles = KIND_STYLES[event.kind]
  const content = (
    <>
      <span className="truncate">{event.label}</span>
      {event.meta && (
        <span className="shrink-0 opacity-70">{event.meta}</span>
      )}
    </>
  )

  const base = cn(
    'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors',
    styles.chip,
  )

  // Native tooltip carries the full text (a chip is often truncated in a narrow cell).
  if (event.href) {
    return (
      <Link
        href={event.href}
        title={eventText(event)}
        className={cn(base, 'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none')}
      >
        {content}
      </Link>
    )
  }
  return <span className={base} title={eventText(event)}>{content}</span>
}
