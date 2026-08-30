import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for the tenant request list. Mirrors the real layout — header with a
// CTA, then a card list of request rows — so the shell doesn't reflow when data arrives.
export default function PortalLoading() {
  return (
    <LoadingRegion label="Loading your requests">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="ml-auto h-5 w-16 rounded-4xl" />
            </li>
          ))}
        </ul>
      </Card>
    </LoadingRegion>
  )
}
