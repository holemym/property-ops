import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the invoices list. Mirrors the real layout — header, a filter row,
// and a table — so the shell doesn't reflow when data arrives.
export default function InvoicesLoading() {
  return (
    <LoadingRegion label="Loading invoices…">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-32 rounded-lg" />
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
