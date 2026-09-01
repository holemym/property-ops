import { FormSkeleton, LoadingRegion } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label="Loading new unit…">
      <FormSkeleton />
    </LoadingRegion>
  )
}
