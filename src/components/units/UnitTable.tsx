import Link from 'next/link'
import { DataTable, type Column } from '@/components/common/DataTable'
import { StatusBadge } from '@/components/common/StatusBadge'
import type { Unit } from '@/lib/data/units'

const columns: Column<Unit>[] = [
  {
    header: 'Label',
    cell: (u) => (
      <Link href={`/units/${u.id}`} className="font-medium hover:underline">
        {u.label}
      </Link>
    ),
  },
  { header: 'Floor', cell: (u) => u.floor ?? '—' },
  { header: 'Occupancy', cell: (u) => u.occupancy_type.replace(/_/g, ' ') },
  { header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
]

export function UnitTable({ units }: { units: Unit[] }) {
  return <DataTable columns={columns} rows={units} />
}
