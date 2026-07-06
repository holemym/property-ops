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
    <div className="overflow-hidden rounded-lg border">
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
  )
}
