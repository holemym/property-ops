import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for My documents. Mirrors portal/loading.tsx's shape (header, then a
// card list of rows) so the shell doesn't reflow when data arrives.
export default function PortalDocumentsLoading() {
  return (
    <LoadingRegion label="Loading your documents">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="ml-auto h-4 w-16" />
            </li>
          ))}
        </ul>
      </Card>
    </LoadingRegion>
  )
}
