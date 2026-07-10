import { MapPinned } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Static mock of the upcoming /map feature (Track M) — demo-workspace only, presentational,
// no data layer. When Track M ships, delete this file and its Sidebar "Preview" entry
// (the real /map page takes its place under Portfolio).
const PINS = [
  { name: 'Ringstrasse Residenz', address: 'Ringstrasse 12, 1010 Wien', units: 4, open: 2, x: 62, y: 38 },
  { name: 'Mariahilfer Hof', address: 'Mariahilfer Strasse 88, 1070 Wien', units: 4, open: 1, x: 28, y: 58 },
]

export default async function PreviewMapPage() {
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Map"
        subtitle="Your properties, plotted by address."
        actions={<Badge variant="muted">Planned — preview</Badge>}
      />

      <Card>
        <CardContent className="p-0">
          <div className="relative h-[420px] w-full overflow-hidden rounded-xl bg-muted/40 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:32px_32px]">
            {PINS.map((pin) => (
              <div
                key={pin.name}
                className="group absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
              >
                <div className="flex flex-col items-center">
                  <div className="mb-1 hidden min-w-48 rounded-lg border bg-popover p-2.5 text-left shadow-md group-hover:block">
                    <p className="text-sm font-medium text-foreground">{pin.name}</p>
                    <p className="text-xs text-muted-foreground">{pin.address}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {pin.units} units · {pin.open} open tickets
                    </p>
                  </div>
                  <MapPinned className="size-7 fill-foreground text-background drop-shadow" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        The real version will geocode each property&rsquo;s address once and plot it on
        an interactive OpenStreetMap view, with a popup linking straight to the property.
      </p>
    </div>
  )
}
