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
    <div className="overflow-hidden rounded-lg border">
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
                  className="after:absolute after:inset-0 group-hover:underline"
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
  )
}
