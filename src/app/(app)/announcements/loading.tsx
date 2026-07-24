import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Loading fallback for the Announcements compose surface. Mirrors the real layout —
// header with a compose action, then a stack of notice cards — so the shell doesn't
// reflow when data arrives.
export default function AnnouncementsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <div className="flex flex-col gap-3 p-1">
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="ml-auto h-7 w-24 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
