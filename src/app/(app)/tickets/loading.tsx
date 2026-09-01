import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the tickets list. Mirrors the real layout — header, filter bar,
// and a six-column table — so the shell doesn't reflow when data arrives.
export default function TicketsLoading() {
  return (
    <LoadingRegion label="Loading tickets…">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-full max-w-xs" />
        <Skeleton className="h-8 w-16" />
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-20" />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-4xl" />
              <Skeleton className="h-5 w-16 rounded-4xl" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}
