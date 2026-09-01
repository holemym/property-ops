import { HubSkeleton, LoadingRegion } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label="Loading property…">
      <HubSkeleton />
    </LoadingRegion>
  )
}
