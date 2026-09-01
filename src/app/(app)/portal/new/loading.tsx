import { FormSkeleton, LoadingRegion } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label="Loading report an issue…">
      <FormSkeleton fields={4} />
    </LoadingRegion>
  )
}
