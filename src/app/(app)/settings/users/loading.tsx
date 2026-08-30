import { LoadingRegion, PageHeaderSkeleton, Skel, TableSkeleton } from '@/components/common/skeletons'

// Mirrors the real page: header, the invite form row, then the members table —
// without the form row the table jumped down when content landed.
export default function UsersLoading() {
  return (
    <LoadingRegion label="Loading users">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap items-end gap-2 rounded-xl border p-4">
        <Skel className="h-8 w-64" />
        <Skel className="h-8 w-36" />
        <Skel className="h-8 w-24 rounded-md" />
      </div>
      <TableSkeleton rows={5} />
    </LoadingRegion>
  )
}
