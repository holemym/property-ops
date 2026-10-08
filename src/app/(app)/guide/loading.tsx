import { LoadingRegion, PageHeaderSkeleton, Skel } from '@/components/common/skeletons'

// Mirrors /guide: header, the chapter rail (lg+), then chapter blocks of numbered steps.
export default function GuideLoading() {
  return (
    <LoadingRegion label="Loading guide…">
      <PageHeaderSkeleton />
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
        <div className="hidden flex-col gap-2 lg:flex">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skel key={i} className="h-8 w-full rounded-md" />
          ))}
        </div>
        <div className="flex flex-col gap-10">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skel className="h-6 w-56" />
              <Skel className="h-4 w-96 max-w-full" />
              <Skel className="h-9 w-64 rounded-lg" />
              <div aria-hidden className="flex flex-col divide-y rounded-xl border">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="flex items-center justify-between gap-4 px-4 py-3.5">
                    <Skel className="h-4 w-2/3" />
                    <Skel className="h-7 w-28 rounded-md" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}
