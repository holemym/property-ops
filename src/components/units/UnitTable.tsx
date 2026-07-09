import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/badge'
import type { Unit } from '@/lib/data/units'

// Rows are clickable to the unit detail page via a stretched Link on the label cell.
export function UnitTable({ units }: { units: Unit[] }) {
  return (
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {units.map((u) => (
          <li key={u.id}>
            <Link
              href={`/units/${u.id}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <span className="font-medium leading-snug">{u.label}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="unit_status" value={u.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate capitalize">
                  {u.occupancy_type.replace(/_/g, ' ')}
                </span>
                <span className="shrink-0">Floor {u.floor ?? '—'}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden overflow-hidden rounded-lg border sm:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Label</TableHead>
            <TableHead className="px-4">Floor</TableHead>
            <TableHead className="px-4">Occupancy</TableHead>
            <TableHead className="px-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {units.map((u) => (
            <TableRow key={u.id} className="group relative cursor-pointer">
              <TableCell className="px-4 py-3 font-medium">
                <Link
                  href={`/units/${u.id}`}
                  className="after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                >
                  {u.label}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">{u.floor ?? '—'}</TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground capitalize">
                {u.occupancy_type.replace(/_/g, ' ')}
              </TableCell>
              <TableCell className="px-4 py-3">
                <StatusBadge kind="unit_status" value={u.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
