import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the ticket board. Mirrors the real layout — header plus a row of
// status columns each holding a few card skeletons — so the shell doesn't reflow when data
// arrives. Card counts per column are arbitrary placeholders.
const COLUMN_CARD_COUNTS = [3, 2, 2, 1, 2, 1, 1, 0, 0]

export default function TicketBoardLoading() {
  return (
    <LoadingRegion label="Loading ticket board…">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      <div className="flex gap-4 overflow-x-hidden pb-4">
        {COLUMN_CARD_COUNTS.map((count, col) => (
          <div
            key={col}
            className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between px-3 py-2.5">
              <Skeleton className="h-5 w-20 rounded-4xl" />
              <Skeleton className="h-4 w-4" />
            </div>
            <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
              {Array.from({ length: count }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-lg bg-card p-3 ring-1 ring-foreground/10"
                >
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-16 rounded-4xl" />
                  <Skeleton className="h-3 w-32" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
