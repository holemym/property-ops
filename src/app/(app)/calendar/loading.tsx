import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the month calendar. Mirrors the real layout — header with month
// nav, month title + legend, and a 6×7 grid of day cells — so the shell doesn't reflow
// when data arrives. The pulse is neutralized under prefers-reduced-motion by the global
// guard in globals.css.
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-7 w-14 rounded-lg" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {/* Weekday header row */}
        <div className="grid grid-cols-7 border-b bg-muted/40">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex justify-center px-2 py-2">
              <Skeleton className="h-3.5 w-8" />
            </div>
          ))}
        </div>

        {/* 6 weeks × 7 days */}
        <div className="grid grid-cols-7">
          {Array.from({ length: 42 }).map((_, i) => {
            const lastCol = (i + 1) % 7 === 0
            const lastRow = i >= 42 - 7
            return (
              <div
                key={i}
                className={`min-h-24 border-b border-r p-1.5 sm:min-h-28 ${lastCol ? 'border-r-0' : ''} ${lastRow ? 'border-b-0' : ''}`}
              >
                <Skeleton className="h-6 w-6 rounded-full" />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
