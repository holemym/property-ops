import { FormSkeleton, LoadingRegion } from '@/components/common/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label="Loading edit invoice…">
      <FormSkeleton fields={7} />
    </LoadingRegion>
  )
}
