import Link from 'next/link'
import { StatusBadge } from '@/components/ui/badge'
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
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it
          hides). The unit label links to the unit hub — these rows ARE units. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row) => (
          <li key={row.unitId} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <Link
                href={`/units/${row.unitId}`}
                className="min-w-0 truncate font-medium leading-snug text-foreground hover:underline"
              >
                {row.label}
              </Link>
              <span className="shrink-0 text-right tabular-nums">
                {typeof row.rent === 'number' ? (
                  <>
                    {formatMoney(row.rent)}
                    <span className="text-xs text-muted-foreground"> / mo</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge kind="unit_status" value={row.status} />
              <span className={row.tenantName ? 'text-sm' : 'text-sm text-muted-foreground'}>
                {row.tenantName ?? '—'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{row.propertyName}</span>
              <span className="shrink-0 tabular-nums">
                {row.leaseStart ? formatDate(row.leaseStart) : '—'} –{' '}
                {row.status === 'OCCUPIED'
                  ? row.leaseEnd
                    ? formatDate(row.leaseEnd)
                    : 'Open-ended'
                  : '—'}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table (already inside a Card on the page, so no extra border). */}
      <div className="hidden sm:block">
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
            <TableCell className="font-medium text-foreground">
              <Link href={`/units/${row.unitId}`} className="hover:underline">
                {row.label}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.propertyName}</TableCell>
            <TableCell>
              <StatusBadge kind="unit_status" value={row.status} />
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
      </div>
    </>
  )
}
