import { PageHeaderSkeleton, CardSkeleton } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton withAction />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <CardSkeleton className="h-64 lg:col-span-2" />
        <CardSkeleton className="h-64" />
      </div>
    </div>
  )
}
