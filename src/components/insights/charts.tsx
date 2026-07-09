'use client'

import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { formatMoney, formatCount } from '@/lib/insights/format'

// Lightweight, dependency-free chart primitives for the Insights dashboard. Everything
// is inline SVG / CSS tuned to the graphite palette — no charting library, matching the
// minimal aesthetic and keeping the bundle lean. Colours come from design tokens and the
// StatusBadge tone classes; bars use `bg-foreground` tints so saturated colour stays
// reserved for status. RankBars rows and the TrendChart are interactive (hover/focus),
// hence the client boundary — the primitives themselves render no server-only data.
//
// formatMoney/formatDays/formatCount live in src/lib/insights/format.ts (NOT here) —
// this file is 'use client', and insights/page.tsx (a Server Component) must call them
// directly to build metric strings. A plain function exported from a client module
// becomes a client reference; Next.js throws if server code invokes it directly.

// ---------------------------------------------------------------------------
// Horizontal ranking bars — a labelled row per item with a proportional track and a
// right-aligned value. Used for cost-by-category, cost-by-property and problem units.
// A row with an `href` renders as a next/link and gains a drill-down affordance
// (hover/focus emphasis on the bar + label); rows without stay plain, non-interactive.
// ---------------------------------------------------------------------------

export type RankBarRow = {
  key: string
  label: string
  // Optional secondary line under the label (e.g. property name, ticket count).
  sublabel?: string
  // The magnitude that sizes the bar.
  value: number
  // The formatted string shown at the row's right edge.
  display: string
  // Optional drill-down target. When present the whole row becomes a link.
  href?: string
}

export function RankBars({ rows }: { rows: RankBarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <RankBarRowItem key={row.key} row={row} max={max} />
      ))}
    </ul>
  )
}

function RankBarRowItem({ row, max }: { row: RankBarRow; max: number }) {
  const pct = Math.max(2, Math.round((row.value / max) * 100))

  // Shared inner markup. The `group` utilities let both the bar fill and the label
  // react to hover/focus of the whole row without per-element handlers or state.
  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium text-foreground">{row.label}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{row.display}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full bg-foreground/70 transition-[width,background-color]',
              row.href && 'group-hover:bg-foreground group-focus-visible:bg-foreground',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {row.sublabel && <span className="text-xs text-muted-foreground">{row.sublabel}</span>}
    </>
  )

  if (row.href) {
    return (
      <li>
        <Link
          href={row.href}
          className={cn(
            'group -mx-2 flex flex-col gap-1 rounded-lg px-2 py-1 transition-colors',
            'hover:bg-muted/50 focus-visible:bg-muted/50',
            'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
          )}
        >
          {inner}
        </Link>
      </li>
    )
  }

  return (
    <li className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted/40">
      {inner}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Trends mini-chart — grouped opened/resolved columns per month with a spend line
// overlaid, drawn as inline SVG. Hovering (or focusing, for keyboard users) a month
// reveals a tooltip with that month's figures and a vertical crosshair. State is a
// single hovered-index; per-month transparent hit-rects drive it via pointer + focus
// events, so the whole column slot is a target rather than the thin bars alone.
// ---------------------------------------------------------------------------

export type TrendPoint = {
  month: string // YYYY-MM
  opened: number
  resolved: number
  spend: number
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [active, setActive] = useState<number | null>(null)

  const W = 640
  const H = 200
  const padX = 8
  const padTop = 12
  const padBottom = 28
  const plotH = H - padTop - padBottom
  const plotW = W - padX * 2

  const maxCount = Math.max(1, ...points.flatMap((p) => [p.opened, p.resolved]))
  const maxSpend = Math.max(1, ...points.map((p) => p.spend))

  const slot = plotW / points.length
  const barGroupW = slot * 0.6
  const barW = barGroupW / 2

  const y = (count: number) => padTop + plotH - (count / maxCount) * plotH
  const spendY = (spend: number) => padTop + plotH - (spend / maxSpend) * plotH

  // Centre of a month's slot, in SVG user units.
  const slotCenter = (i: number) => padX + slot * i + slot / 2

  // Spend polyline points, centred over each month slot.
  const spendPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${slotCenter(i).toFixed(1)},${spendY(p.spend).toFixed(1)}`)
    .join(' ')

  const shortMonth = (month: string) => month.slice(5) // 'MM'

  // Tooltip horizontal position as a percentage of the container width. Near the right
  // edge we flip the anchor so the card grows leftward and never clips out of frame.
  const activePoint = active === null ? null : points[active]
  const centerPct = active === null ? 0 : (slotCenter(active) / W) * 100
  const flip = centerPct > 62

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-48 w-full"
          role="img"
          aria-label="Monthly tickets opened versus resolved, with spend"
        >
          {/* Baseline */}
          <line
            x1={padX}
            y1={padTop + plotH}
            x2={W - padX}
            y2={padTop + plotH}
            className="stroke-border"
            strokeWidth={1}
          />

          {/* Crosshair at the active month, drawn under the bars/points. */}
          {active !== null && (
            <line
              x1={slotCenter(active)}
              y1={padTop}
              x2={slotCenter(active)}
              y2={padTop + plotH}
              className="stroke-foreground/25"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {points.map((p, i) => {
            const groupX = padX + slot * i + (slot - barGroupW) / 2
            const isActive = active === i
            return (
              <g key={p.month}>
                <rect
                  x={groupX}
                  y={y(p.opened)}
                  width={barW}
                  height={padTop + plotH - y(p.opened)}
                  rx={1.5}
                  className={cn('fill-foreground/30', isActive && 'fill-foreground/50')}
                />
                <rect
                  x={groupX + barW}
                  y={y(p.resolved)}
                  width={barW}
                  height={padTop + plotH - y(p.resolved)}
                  rx={1.5}
                  className={cn('fill-foreground/70', isActive && 'fill-foreground')}
                />
                <text
                  x={slotCenter(i)}
                  y={H - 8}
                  textAnchor="middle"
                  className={cn(
                    'text-[10px]',
                    isActive ? 'fill-foreground' : 'fill-muted-foreground',
                  )}
                >
                  {shortMonth(p.month)}
                </text>
              </g>
            )
          })}

          {/* Spend line */}
          <path d={spendPath} fill="none" className="stroke-blue-500" strokeWidth={1.75} />
          {points.map((p, i) => (
            <circle
              key={p.month}
              cx={slotCenter(i)}
              cy={spendY(p.spend)}
              r={active === i ? 3.5 : 2.5}
              className="fill-blue-500"
            />
          ))}

          {/* Transparent per-month hit targets, on top so they capture pointer + focus.
              Focusable for keyboard users; each announces the month's figures. */}
          {points.map((p, i) => (
            <rect
              key={p.month}
              x={padX + slot * i}
              y={padTop}
              width={slot}
              height={plotH}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`${p.month}: ${p.opened} opened, ${p.resolved} resolved, ${formatMoney(p.spend)} spend`}
              className="cursor-default focus-visible:outline-none"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
              onFocus={() => setActive(i)}
              onBlur={() => setActive((cur) => (cur === i ? null : cur))}
            />
          ))}
        </svg>

        {/* Tooltip — absolutely positioned over the chart, anchored to the active slot
            centre and flipped near the right edge so it stays in frame. */}
        {activePoint && (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md',
              flip ? '-translate-x-full' : '',
            )}
            style={{
              left: `${centerPct}%`,
              marginLeft: flip ? -8 : 8,
            }}
          >
            <div className="mb-1 font-medium tabular-nums text-foreground">{activePoint.month}</div>
            <dl className="flex flex-col gap-0.5">
              <TooltipRow dotClass="bg-foreground/30" label="Opened" value={formatCount(activePoint.opened)} />
              <TooltipRow dotClass="bg-foreground/70" label="Resolved" value={formatCount(activePoint.resolved)} />
              <TooltipRow dotClass="bg-blue-500" label="Spend" value={formatMoney(activePoint.spend)} />
            </dl>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <LegendDot className="bg-foreground/30" label="Opened" />
        <LegendDot className="bg-foreground/70" label="Resolved" />
        <LegendDot className="bg-blue-500" label="Spend" />
      </div>
    </div>
  )
}

function TooltipRow({ dotClass, label, value }: { dotClass: string; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn('size-2 rounded-full', dotClass)} aria-hidden />
        {label}
      </dt>
      <dd className="tabular-nums font-medium text-foreground">{value}</dd>
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-full', className)} aria-hidden />
      {label}
    </span>
  )
}
