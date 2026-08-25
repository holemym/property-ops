import { Skel, LoadingRegion } from '@/components/common/skeletons'

// Loading fallback for Settings → Security. Mirrors the three stacked cards (two-factor,
// password, recent activity), each with the bordered header the real page uses, so the
// page settles in place rather than jumping as the factor list and audit rows resolve.
export default function SecuritySettingsLoading() {
  return (
    <LoadingRegion label="Loading security settings">
      <div className="flex flex-col gap-2">
        <Skel className="h-7 w-32" />
        <Skel className="h-4 w-80 max-w-full" />
      </div>

      {/* Two-factor + Password + Recent activity */}
      {[
        { body: 'h-9 w-52' },
        { body: 'h-9 w-36' },
        { body: 'h-24 w-full' },
      ].map((card, i) => (
        <div key={i} aria-hidden className="rounded-xl border">
          <div className="flex flex-col gap-2 border-b px-6 py-4">
            <Skel className="h-4 w-48" />
            <Skel className="h-3 w-72 max-w-full" />
          </div>
          <div className="px-6 py-4">
            <Skel className={`${card.body} rounded-md`} />
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}
