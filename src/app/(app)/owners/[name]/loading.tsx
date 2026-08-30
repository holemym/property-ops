import { LoadingRegion, Skel, CardSkeleton, TableSkeleton } from '@/components/common/skeletons'

// Loading fallback for one owner's statement — back link, header, the three
// billed/paid/outstanding stat cards, then the invoice table.
export default function OwnerStatementLoading() {
  return (
    <LoadingRegion label="Loading owner statement">
      <Skel className="h-4 w-20" />
      <div className="flex flex-col gap-2">
        <Skel className="h-7 w-48" />
        <Skel className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} className="h-20" />
        ))}
      </div>
      <TableSkeleton rows={5} />
    </LoadingRegion>
  )
}
