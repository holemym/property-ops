import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the occupancy tape chart. Mirrors the real layout — header, a
// month ruler, and a couple of property groups of unit rows with skeleton tracks — so
// the shell doesn't reflow when data arrives.
export default function OccupancyLoading() {
  return (
    <LoadingRegion label="Loading occupancy…">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {/* Month ruler */}
        <div className="flex items-center border-b px-4 py-2.5">
          <Skeleton className="h-3.5 w-24" />
          <div className="ml-6 flex flex-1 gap-10">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-3.5 w-14" />
            ))}
          </div>
        </div>

        {Array.from({ length: 2 }).map((_, g) => (
          <div key={g}>
            <div className="border-b bg-muted/40 px-4 py-1.5">
              <Skeleton className="h-3.5 w-32" />
            </div>
            {Array.from({ length: 3 }).map((_, r) => (
              <div key={r} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <Skeleton className="h-4 w-28 shrink-0" />
                <Skeleton className="h-6 flex-1 rounded-md" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
