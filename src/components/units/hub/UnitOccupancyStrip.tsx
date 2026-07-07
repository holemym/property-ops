import { cn } from '@/lib/utils'
import type { OccupancySegment, OccupancyState, DateWindow } from '@/lib/occupancy/timeline'

// A compact, self-contained occupancy bar for ONE unit — a single horizontal track that
// spans the timeline window, colored by occupancy state, with month ticks above and a
// "today" marker. Deliberately does NOT import the full TapeChart (that is a units × time
// grid); this is a slim standalone strip. Tones mirror the TapeChart / StatusBadge status
// tones (OCCUPIED→blue, VACANT→amber, MAINTENANCE→amber+hatch, BLOCKED→red) so it reads
// consistently with the badges elsewhere.

function toMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`)
}

function fractionOf(iso: string, fromMs: number, spanMs: number): number {
  const f = (toMs(iso) - fromMs) / spanMs
  return f < 0 ? 0 : f > 1 ? 1 : f
}

function pct(n: number): string {
  return `${Math.round(n * 10000) / 100}%`
}

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

type MonthTick = { key: string; label: string; leftPct: string }

function monthTicks(window: DateWindow, fromMs: number, spanMs: number): MonthTick[] {
  const ticks: MonthTick[] = []
  const start = new Date(fromMs)
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  const endMs = toMs(window.to)
  for (let guard = 0; guard < 60; guard++) {
    const colStartMs = Date.UTC(year, month, 1)
    if (colStartMs >= endMs) break
    const iso = new Date(colStartMs).toISOString().slice(0, 10)
    ticks.push({
      key: iso,
      label: new Date(colStartMs).toLocaleDateString('en-US', {
        month: 'short',
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
  return ticks
}

export function UnitOccupancyStrip({
  segments,
  window,
  todayIso,
}: {
  segments: OccupancySegment[]
  window: DateWindow
  todayIso: string
}) {
  const fromMs = toMs(window.from)
  const spanMs = toMs(window.to) - fromMs
  const ticks = monthTicks(window, fromMs, spanMs)
  const todayInWindow = todayIso >= window.from && todayIso < window.to
  const todayFraction = todayInWindow ? fractionOf(todayIso, fromMs, spanMs) : 0

  return (
    <div className="flex flex-col gap-1.5">
      {/* Month tick labels */}
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t.key}
            className="absolute top-0 pl-1 text-[11px] leading-none text-muted-foreground"
            style={{ left: t.leftPct }}
          >
            {t.label}
          </span>
        ))}
      </div>

      {/* The occupancy bar */}
      <div className="relative h-7 overflow-hidden rounded-md ring-1 ring-foreground/10">
        {segments.map((seg, i) => {
          const left = fractionOf(seg.from, fromMs, spanMs)
          const right = fractionOf(seg.to, fromMs, spanMs)
          const width = right - left
          if (width <= 0) return null
          const showName = seg.state === 'OCCUPIED' && seg.tenantName && width > 0.14
          return (
            <div
              key={`${seg.from}-${i}`}
              className={cn(
                'absolute inset-y-0 flex items-center overflow-hidden px-2 text-[11px] font-medium',
                SEGMENT_TONE[seg.state]
              )}
              style={{ left: pct(left), width: pct(width) }}
              title={
                seg.state === 'OCCUPIED' && seg.tenantName
                  ? `${seg.tenantName} · ${SEGMENT_LABEL[seg.state]}`
                  : SEGMENT_LABEL[seg.state]
              }
            >
              <span className="truncate">{showName ? seg.tenantName : ''}</span>
            </div>
          )
        })}

        {/* Month gridlines */}
        {ticks.map((t) =>
          t.leftPct === '0%' ? null : (
            <span
              key={`grid-${t.key}`}
              className="absolute inset-y-0 w-px bg-foreground/10"
              style={{ left: t.leftPct }}
              aria-hidden
            />
          )
        )}

        {/* Today marker */}
        {todayInWindow && (
          <span
            className="absolute inset-y-0 z-10 w-0.5 bg-foreground/50"
            style={{ left: pct(todayFraction) }}
            aria-hidden
            title="Today"
          />
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <LegendSwatch className="bg-blue-100 dark:bg-blue-500/25" label="Occupied" />
        <LegendSwatch className="bg-amber-50 dark:bg-amber-500/10" label="Vacant" />
        <LegendSwatch className="bg-amber-100 dark:bg-amber-500/25" label="Maintenance" />
        <LegendSwatch className="bg-red-100 dark:bg-red-500/25" label="Blocked" />
      </div>
    </div>
  )
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-sm', className)} aria-hidden />
      {label}
    </span>
  )
}
