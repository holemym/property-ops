import Link from 'next/link'
import { ChevronRight, DoorClosed } from 'lucide-react'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import type { Unit } from '@/lib/data/units'

// Compact list of a property's units. Each row links to the unit hub at /units/[id]
// and shows the unit status pill plus floor. Occupancy is passed in per-unit (a unit
// counts occupied if a tenancy covers today OR status='OCCUPIED') so the list can flag
// it without re-deriving. EmptyState when the property has no units. Self-contained.
export function UnitsList({
  units,
  occupiedUnitIds,
}: {
  units: Unit[]
  occupiedUnitIds: Set<string>
}) {
  if (units.length === 0) {
    return (
      <EmptyState
        icon={<DoorClosed />}
        title="No units yet"
        body="Add units to this property to track occupancy, access details, and tickets."
      />
    )
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {units.map((u) => {
        const floor = u.floor?.trim()
        const occupied = occupiedUnitIds.has(u.id)
        return (
          <li key={u.id}>
            <Link
              href={`/units/${u.id}`}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{u.label}</span>
                  <StatusBadge kind="unit_status" value={u.status} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {floor ? `Floor ${floor}` : 'No floor set'}
                  {occupied ? ' · Occupied today' : ' · Vacant today'}
                </span>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
