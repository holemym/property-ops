import { PageHeaderSkeleton, CardSkeleton, LoadingRegion } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label="Loading vendor…">
      <PageHeaderSkeleton withAction />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <CardSkeleton className="h-64 lg:col-span-2" />
        <CardSkeleton className="h-64" />
      </div>
    </LoadingRegion>
  )
}
