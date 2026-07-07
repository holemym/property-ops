import type { ReactNode } from 'react'

// A compact row of headline numbers for the property hub. Each metric is a label +
// value pair with an optional accent tone for the net figure (green positive / red
// negative). Self-contained; graphite by default. Enter animation is CSS-only and
// gated on prefers-reduced-motion by the parent's `hub-enter` utility usage.
export type Metric = {
  label: string
  value: ReactNode
  hint?: string
  tone?: 'default' | 'positive' | 'negative'
}

const TONE: Record<NonNullable<Metric['tone']>, string> = {
  default: 'text-foreground',
  positive: 'text-green-700 dark:text-green-400',
  negative: 'text-red-700 dark:text-red-400',
}

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-foreground/10 ring-1 ring-foreground/10 sm:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.label} className="flex flex-col gap-1 bg-card px-4 py-3">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {m.label}
          </span>
          <span className={`text-2xl font-semibold tabular-nums ${TONE[m.tone ?? 'default']}`}>
            {m.value}
          </span>
          {m.hint && <span className="text-xs text-muted-foreground">{m.hint}</span>}
        </div>
      ))}
    </div>
  )
}
