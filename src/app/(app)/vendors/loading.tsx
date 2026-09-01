import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the vendors list. Mirrors the real layout — header, filter bar,
// and a four-column table — so the shell doesn't reflow when data arrives.
export default function VendorsLoading() {
  return (
    <LoadingRegion label="Loading vendors…">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-36" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-full max-w-sm" />
        <Skeleton className="h-8 w-16" />
      </div>

      <ListTableSkeleton />
    </LoadingRegion>
  )
}

function ListTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-24" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-16 rounded-4xl" />
          </div>
        ))}
      </div>
    </div>
  )
}
