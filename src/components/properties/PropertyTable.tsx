import Link from 'next/link'
import { DataTable, type Column } from '@/components/common/DataTable'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { Property } from '@/lib/data/properties'

const columns: Column<Property>[] = [
  {
    header: 'Name',
    cell: (p) => (
      <Link href={`/properties/${p.id}`} className="font-medium hover:underline">
        {p.name}
      </Link>
    ),
  },
  { header: 'City', cell: (p) => p.city },
  { header: 'Type', cell: (p) => p.property_type.replace(/_/g, ' ') },
  { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
]

export function PropertyTable({ properties }: { properties: Property[] }) {
  return <DataTable columns={columns} rows={properties} />
}
