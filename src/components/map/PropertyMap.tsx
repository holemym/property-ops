'use client'

import dynamic from 'next/dynamic'
import { CardSkeleton } from '@/components/common/skeletons'

// The slim, pre-aggregated shape the map needs per pin — deliberately NOT the full
// Property/Unit/Ticket rows (keeps the client payload small and this component decoupled
// from the data layer). src/app/(app)/map/page.tsx computes this from
// listProperties/listUnits/listTickets before rendering <PropertyMap>.
export type MapProperty = {
  id: string
  name: string
  address: string
  latitude: number
  longitude: number
  unitCount: number
  openTicketCount: number
}

// MapLibre needs a real DOM + WebGL context, so it can only ever run on the client. This
// ssr:false dynamic import (only legal inside a Client Component — see
// node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md) also keeps `maplibre-gl`
// out of the shared client bundle: it's split into its own chunk, fetched only when a
// manager actually opens /map (the M2 build-output acceptance check).
const VectorMap = dynamic(() => import('./VectorMap'), {
  ssr: false,
  loading: () => <CardSkeleton className="h-full w-full" />,
})

// Public entry point rendered from the (server) /map page. Owns the map's fixed footprint
// so the container has a real height BEFORE the map mounts into it (a zero-height canvas
// at init renders broken) — mirrors the spec's mobile sizing (h-[60vh] min-h-80) at every
// viewport, not just phones. rounded-xl matches the app's card radius.
export function PropertyMap({ properties }: { properties: MapProperty[] }) {
  return (
    <div className="h-[60vh] w-full min-h-80 overflow-hidden rounded-xl border">
      <VectorMap properties={properties} />
    </div>
  )
}
