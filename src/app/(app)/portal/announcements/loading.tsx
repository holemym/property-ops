import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for Announcements. Mirrors the real layout — header, then a stack of
// notice cards — so the shell doesn't reflow when data arrives.
export default function PortalAnnouncementsLoading() {
  return (
    <LoadingRegion label="Loading announcements">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <div className="flex flex-col gap-3 p-1">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </Card>
        ))}
      </div>
    </LoadingRegion>
  )
}
