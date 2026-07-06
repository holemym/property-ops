import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the dashboard route. Mirrors the real layout — header, the
// six-up metric strip, and the two-column queue grid — so the shell doesn't reflow
// when data arrives. The pulse is reduced-motion-safe via the global guard.
export default function DashboardLoading() {
  return (
    <div>
      {/* Page header */}
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Metric strip — six graphite cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <Skeleton className="h-8 w-10" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>

      {/* Queue grid — five list cards */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <QueueCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

function QueueCardSkeleton() {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-3 w-14" />
      </div>
      <ul className="flex flex-col divide-y">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Skeleton className="h-5 w-14 rounded-4xl" />
              <Skeleton className="h-5 w-16 rounded-4xl" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
