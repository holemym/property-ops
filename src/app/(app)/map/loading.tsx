import { PageHeaderSkeleton, CardSkeleton, Skel, LoadingRegion } from '@/components/common/skeletons'

// Loading fallback for /map. Mirrors the real layout вЂ” header, the "N of M located" note,
// and the map's own footprint вЂ” so the shell doesn't reflow when data (and MapLibre) arrive.
export default function MapLoading() {
  return (
    <LoadingRegion label="Loading the map">
      <PageHeaderSkeleton />
      <Skel className="h-4 w-48" />
      <CardSkeleton className="h-[60vh] w-full min-h-80" />
    </LoadingRegion>
  )
}
