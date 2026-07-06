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
import type { Property } from '@/lib/data/properties'

// Rows are clickable to the property detail page. The name cell holds a stretched
// Link (after:absolute inset-0) so the whole row is a single, accessible navigation
// target without client-side JS. Interactive cells would need `relative z-10`, but
// this table has none.
export function PropertyTable({ properties }: { properties: Property[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Name</TableHead>
            <TableHead className="px-4">City</TableHead>
            <TableHead className="px-4">Type</TableHead>
            <TableHead className="px-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {properties.map((p) => (
            <TableRow key={p.id} className="group relative cursor-pointer">
              <TableCell className="px-4 py-3 font-medium">
                <Link
                  href={`/properties/${p.id}`}
                  className="after:absolute after:inset-0 group-hover:underline"
                >
                  {p.name}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">{p.city}</TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground capitalize">
                {p.property_type.replace(/_/g, ' ')}
              </TableCell>
              <TableCell className="px-4 py-3">
                <StatusBadge kind="entity_status" value={p.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
