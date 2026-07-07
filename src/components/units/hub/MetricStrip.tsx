import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// A compact metric card grid for the unit hub header. Each metric is a small stat with
// a muted label, a prominent value, and an optional sub-line / accent tone. Graphite by
// default; `tone` tints only the value so saturated color stays reserved for signal.

export type MetricTone = 'default' | 'amber' | 'red'

export type Metric = {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: MetricTone
}

const VALUE_TONE: Record<MetricTone, string> = {
  default: 'text-foreground',
  amber: 'text-amber-700 dark:text-amber-300',
  red: 'text-red-700 dark:text-red-300',
}

export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="flex flex-col gap-1 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10"
        >
          <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
          <span
            className={cn(
              'text-lg leading-tight font-semibold tracking-tight',
              VALUE_TONE[m.tone ?? 'default']
            )}
          >
            {m.value}
          </span>
          {m.sub != null && (
            <span className="truncate text-xs text-muted-foreground">{m.sub}</span>
          )}
        </div>
      ))}
    </div>
  )
}
