import { cn } from '@/lib/utils'

// Lightweight, dependency-free chart primitives for the Insights dashboard. Everything
// is inline SVG / CSS tuned to the graphite palette — no charting library, matching the
// minimal aesthetic and keeping the bundle lean. Colours come from design tokens and the
// StatusBadge tone classes; bars use `bg-foreground` tints so saturated colour stays
// reserved for status.

// Round-and-format helpers. Money is EUR, whole-euro (no cents — these are aggregates).
const money = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export function formatMoney(value: number): string {
  return money.format(Math.round(value))
}

export function formatDays(value: number | null): string {
  if (value === null) return '—'
  const rounded = Math.round(value)
  return `${rounded.toLocaleString()} ${rounded === 1 ? 'day' : 'days'}`
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString()
}

// ---------------------------------------------------------------------------
// Horizontal ranking bars — a labelled row per item with a proportional track and a
// right-aligned value. Used for cost-by-category, cost-by-property and problem units.
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
}

export function RankBars({ rows }: { rows: RankBarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const pct = Math.max(2, Math.round((row.value / max) * 100))
        return (
          <li key={row.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate font-medium text-foreground">{row.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.display}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            {row.sublabel && (
              <span className="text-xs text-muted-foreground">{row.sublabel}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Trends mini-chart — grouped opened/resolved columns per month with a spend line
// overlaid, drawn as inline SVG. Deterministic, no interactivity.
// ---------------------------------------------------------------------------

export type TrendPoint = {
  month: string // YYYY-MM
  opened: number
  resolved: number
  spend: number
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
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

  // Spend polyline points, centred over each month slot.
  const spendPath = points
    .map((p, i) => {
      const cx = padX + slot * i + slot / 2
      return `${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${spendY(p.spend).toFixed(1)}`
    })
    .join(' ')

  const shortMonth = (month: string) => month.slice(5) // 'MM'

  return (
    <div className="flex flex-col gap-3">
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
        {points.map((p, i) => {
          const groupX = padX + slot * i + (slot - barGroupW) / 2
          return (
            <g key={p.month}>
              <rect
                x={groupX}
                y={y(p.opened)}
                width={barW}
                height={padTop + plotH - y(p.opened)}
                rx={1.5}
                className="fill-foreground/30"
              />
              <rect
                x={groupX + barW}
                y={y(p.resolved)}
                width={barW}
                height={padTop + plotH - y(p.resolved)}
                rx={1.5}
                className="fill-foreground/70"
              />
              <text
                x={padX + slot * i + slot / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {shortMonth(p.month)}
              </text>
            </g>
          )
        })}
        {/* Spend line */}
        <path d={spendPath} fill="none" className="stroke-blue-500" strokeWidth={1.75} />
        {points.map((p, i) => {
          const cx = padX + slot * i + slot / 2
          return (
            <circle
              key={p.month}
              cx={cx}
              cy={spendY(p.spend)}
              r={2.5}
              className="fill-blue-500"
            />
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <LegendDot className="bg-foreground/30" label="Opened" />
        <LegendDot className="bg-foreground/70" label="Resolved" />
        <LegendDot className="bg-blue-500" label="Spend" />
      </div>
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
