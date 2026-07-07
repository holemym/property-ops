import { PageHeaderSkeleton, TableSkeleton } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={5} />
    </div>
  )
}
