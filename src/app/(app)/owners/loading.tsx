import { LoadingRegion, PageHeaderSkeleton, TableSkeleton } from '@/components/common/skeletons'

// Loading fallback for the owners list — shared primitives (sheen + sr-only
// announcement), mirroring the header + table the real page renders.
export default function OwnersLoading() {
  return (
    <LoadingRegion label="Loading owner statements">
      <PageHeaderSkeleton />
      <TableSkeleton rows={5} />
    </LoadingRegion>
  )
}
