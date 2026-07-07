import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the rent roll. Mirrors the real layout — header, a three-metric
// strip, an expiring-leases card, and the rent-roll table — so the shell doesn't reflow
// when data arrives.
export default function RentRollLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-2 h-7 w-20" />
          </div>
        ))}
      </div>

      {/* Expiring-leases card */}
      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-5 w-16 rounded-4xl" />
            </div>
          ))}
        </div>
      </div>

      {/* Rent-roll table */}
      <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <Skeleton className="h-4 w-24" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-20 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-5 w-16 rounded-4xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
