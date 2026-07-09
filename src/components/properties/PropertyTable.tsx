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
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {properties.map((p) => (
          <li key={p.id}>
            <Link
              href={`/properties/${p.id}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <span className="font-medium leading-snug">{p.name}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="entity_status" value={p.status} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">{p.city}</span>
                <span className="shrink-0 capitalize">{p.property_type.replace(/_/g, ' ')}</span>
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
                  className="after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
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
    </>
  )
}
