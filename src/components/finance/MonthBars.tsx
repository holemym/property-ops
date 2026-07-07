import { formatMonth } from './shared'

// Income vs. expense by month, drawn as paired inline-SVG columns per month with a net
// line implied by the height difference. Dependency-free, deterministic, no interactivity
// — mirrors the insights TrendChart aesthetic (graphite tints, blue accent reserved for
// the positive series). Green = income, muted = expense.

export type MonthPoint = {
  month: string // 'YYYY-MM'
  income: number
  expense: number
}

export function MonthBars({ points }: { points: MonthPoint[] }) {
  const W = 640
  const H = 200
  const padX = 8
  const padTop = 12
  const padBottom = 28
  const plotH = H - padTop - padBottom
  const plotW = W - padX * 2

  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]))

  const slot = points.length > 0 ? plotW / points.length : plotW
  const barGroupW = slot * 0.6
  const barW = barGroupW / 2

  const y = (value: number) => padTop + plotH - (value / max) * plotH

  return (
    <div className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-48 w-full"
        role="img"
        aria-label="Monthly income versus expense"
      >
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
                y={y(p.income)}
                width={barW}
                height={padTop + plotH - y(p.income)}
                rx={1.5}
                className="fill-green-500/70"
              />
              <rect
                x={groupX + barW}
                y={y(p.expense)}
                width={barW}
                height={padTop + plotH - y(p.expense)}
                rx={1.5}
                className="fill-foreground/40"
              />
              <text
                x={padX + slot * i + slot / 2}
                y={H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {p.month.slice(5)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <LegendDot className="bg-green-500/70" label="Income" />
        <LegendDot className="bg-foreground/40" label="Expense" />
        <span className="ml-auto">
          {points.length > 0
            ? `${formatMonth(points[0].month)} – ${formatMonth(points[points.length - 1].month)}`
            : null}
        </span>
      </div>
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2.5 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  )
}
