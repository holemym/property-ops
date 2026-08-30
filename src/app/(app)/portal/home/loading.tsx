import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for My Home. Mirrors the real layout — header, then a two-column
// grid of a wide tenancy card and a narrower contact card — so the shell doesn't
// reflow when data arrives.
export default function PortalHomeLoading() {
  return (
    <LoadingRegion label="Loading your home">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-col gap-4 p-1">
            <Skeleton className="h-5 w-32" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3.5 w-72 max-w-full" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex flex-col gap-4 p-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-36 rounded-lg" />
          </div>
        </Card>
      </div>
    </LoadingRegion>
  )
}
