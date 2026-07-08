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
import type { Vendor } from '@/lib/data/vendors'

// Rows are clickable to the vendor detail page via a stretched Link on the company cell.
export function VendorTable({ vendors }: { vendors: Vendor[] }) {
  return (
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides). */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {vendors.map((v) => (
          <li key={v.id}>
            <Link
              href={`/vendors/${v.id}`}
              className="flex flex-col gap-2 rounded-lg border bg-card p-3"
            >
              <span className="font-medium leading-snug">{v.company_name}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge kind="vendor_is_active" value={v.is_active} />
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate capitalize">
                  {v.service_category.replace(/_/g, ' ')}
                </span>
                <span className="shrink-0">{v.contact_name ?? '—'}</span>
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
            <TableHead className="px-4">Company</TableHead>
            <TableHead className="px-4">Category</TableHead>
            <TableHead className="px-4">Contact</TableHead>
            <TableHead className="px-4">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.map((v) => (
            <TableRow key={v.id} className="group relative cursor-pointer">
              <TableCell className="px-4 py-3 font-medium">
                <Link
                  href={`/vendors/${v.id}`}
                  className="after:absolute after:inset-0 group-hover:underline"
                >
                  {v.company_name}
                </Link>
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground capitalize">
                {v.service_category.replace(/_/g, ' ')}
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {v.contact_name ?? '—'}
              </TableCell>
              <TableCell className="px-4 py-3">
                <StatusBadge kind="vendor_is_active" value={v.is_active} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
