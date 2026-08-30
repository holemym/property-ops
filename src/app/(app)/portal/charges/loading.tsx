import { LoadingRegion } from '@/components/common/skeletons'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for My charges. Mirrors the real layout — header, a card list of
// invoice rows, then the static "how to pay" card — so the shell doesn't reflow when
// data arrives.
export default function PortalChargesLoading() {
  return (
    <LoadingRegion label="Loading your charges">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="ml-auto h-5 w-16 rounded-4xl" />
              <Skeleton className="h-4 w-16" />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="flex flex-col gap-2 p-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      </Card>
    </LoadingRegion>
  )
}
