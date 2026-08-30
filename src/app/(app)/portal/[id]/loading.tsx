import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Loading fallback for the tenant request detail. Mirrors the two-column card layout —
// a header with a status pill, a wide summary/messages/attachments column, and a narrow
// status column — so the page doesn't reflow when data arrives.
export default function PortalDetailLoading() {
  return (
    <LoadingRegion label="Loading your request">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <div className="flex flex-wrap items-center gap-2.5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-20 rounded-4xl" />
          <Skeleton className="h-5 w-20 rounded-4xl" />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-28" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-8 w-40" />
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-16" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Skeleton className="h-5 w-20 rounded-4xl" />
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </LoadingRegion>
  )
}
