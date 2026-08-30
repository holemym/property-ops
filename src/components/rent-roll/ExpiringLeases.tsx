import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ExpiringLease } from '@/lib/occupancy/rent-roll'
import { formatDate, formatDaysLeft } from './shared'

// An expiring lease with its unit label resolved by the page (the pure helper only knows
// unit ids). `propertyName` is optional context shown alongside the unit.
export type ExpiringLeaseRow = ExpiringLease & {
  unitLabel: string
  propertyName?: string
}

// "Leases expiring soon" card — a compact list of tenants whose lease ends within the
// window, each with an amber days-left pill. Empty state is a single muted line.
export function ExpiringLeases({
  leases,
  withinDays = 90,
}: {
  leases: ExpiringLeaseRow[]
  withinDays?: number
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leases expiring soon</CardTitle>
      </CardHeader>
      <CardContent>
        {leases.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No leases expiring in the next {withinDays} days.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {leases.map((lease) => (
              <li
                key={`${lease.unitId}-${lease.leaseEnd}`}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{lease.tenantName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {lease.propertyName ? `${lease.propertyName} · ` : ''}
                    <Link href={`/units/${lease.unitId}`} className="hover:underline">
                      {lease.unitLabel}
                    </Link>{' '}
                    · ends {formatDate(lease.leaseEnd)}
                  </p>
                </div>
                <Badge variant="amber" className="shrink-0 tabular-nums">
                  {formatDaysLeft(lease.daysLeft)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
