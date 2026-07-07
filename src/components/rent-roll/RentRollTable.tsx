import { StatusBadge } from '@/components/common/StatusBadge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { RentRollRow } from '@/lib/occupancy/rent-roll'
import { formatMoney, formatDate } from './shared'

// The rent-roll table: one row per unit, showing occupancy status, tenant, rent, and the
// lease span. Vacant units render muted em-dashes for the tenant/rent/lease columns.
// Money is right-aligned and tabular for scannable columns.
export function RentRollTable({ rows }: { rows: RentRollRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Unit</TableHead>
          <TableHead>Property</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Tenant</TableHead>
          <TableHead className="text-right">Rent / mo</TableHead>
          <TableHead>Lease start</TableHead>
          <TableHead>Lease end</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.unitId}>
            <TableCell className="font-medium text-foreground">{row.label}</TableCell>
            <TableCell className="text-muted-foreground">{row.propertyName}</TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell className={row.tenantName ? 'text-foreground' : 'text-muted-foreground'}>
              {row.tenantName ?? '—'}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {typeof row.rent === 'number' ? (
                formatMoney(row.rent)
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {row.leaseStart ? formatDate(row.leaseStart) : '—'}
            </TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {row.status === 'OCCUPIED'
                ? row.leaseEnd
                  ? formatDate(row.leaseEnd)
                  : 'Open-ended'
                : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
