import Link from 'next/link'
import { DataTable, type Column } from '@/components/common/DataTable'
import { Badge } from '@/components/ui/badge'
import type { Vendor } from '@/lib/data/vendors'

const columns: Column<Vendor>[] = [
  {
    header: 'Company',
    cell: (v) => (
      <Link href={`/vendors/${v.id}`} className="font-medium hover:underline">
        {v.company_name}
      </Link>
    ),
  },
  { header: 'Category', cell: (v) => v.service_category.replace(/_/g, ' ') },
  { header: 'Contact', cell: (v) => v.contact_name ?? '—' },
  {
    header: 'Status',
    cell: (v) => (
      <Badge variant={v.is_active ? 'secondary' : 'outline'}>{v.is_active ? 'Active' : 'Inactive'}</Badge>
    ),
  },
]

export function VendorTable({ vendors }: { vendors: Vendor[] }) {
  return <DataTable columns={columns} rows={vendors} />
}
