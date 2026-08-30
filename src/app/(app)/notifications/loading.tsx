import { Skel, LoadingRegion } from '@/components/common/skeletons'

// Loading fallback for the notifications inbox. Mirrors the real page — header with the
// "Mark all read" action, a divided card of rows (type dot · title · body · timestamp),
// and the pager — so nothing reflows when the inbox arrives.
export default function NotificationsLoading() {
  return (
    <LoadingRegion label="Loading notifications">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skel className="h-7 w-40" />
          <Skel className="h-4 w-64 max-w-full" />
        </div>
        <Skel className="h-8 w-28 rounded-md" />
      </div>

      <div className="flex flex-col gap-4">
        <div aria-hidden className="divide-y rounded-xl border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3.5">
              {/* type icon chip (size-6, matching the real row) */}
              <Skel className="mt-0.5 size-6 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skel className="h-4 w-56 max-w-full" />
                <Skel className="h-3 w-72 max-w-full" />
              </div>
              <Skel className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <Skel className="h-3.5 w-32" />
          <div className="flex gap-2">
            <Skel className="h-8 w-20 rounded-md" />
            <Skel className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  )
}
