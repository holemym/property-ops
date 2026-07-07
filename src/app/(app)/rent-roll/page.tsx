import { ReceiptText } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTenancies } from '@/lib/data/tenancies'
import { rentRoll, expiringLeases, totalMonthlyRent } from '@/lib/occupancy/rent-roll'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RentRollTable } from '@/components/rent-roll/RentRollTable'
import { ExpiringLeases, type ExpiringLeaseRow } from '@/components/rent-roll/ExpiringLeases'
import { formatMoney } from '@/components/rent-roll/shared'

// How far ahead a lease-end counts as "expiring soon". Mirrors the helper default.
const WITHIN_DAYS = 90

export default async function RentRollPage() {
  // Rent roll exposes tenant PII + rent, so it shares occupancy's gate — managers +
  // accountant only. Any operator-surface role without occupancy:read is bounced.
  const user = await requirePermission('occupancy:read')

  const supabase = await createClient()
  const [properties, units, tenancies] = await Promise.all([
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
  ])

  const asOf = new Date()
  const rows = rentRoll(units, tenancies, properties, asOf)
  const expiring = expiringLeases(tenancies, asOf, WITHIN_DAYS)

  // Resolve unit labels + property context for the expiring-lease list (the pure helper
  // only knows unit ids).
  const unitLabel = new Map(units.map((u) => [u.id, u.label]))
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitProperty = new Map(units.map((u) => [u.id, u.property_id]))
  const expiringRows: ExpiringLeaseRow[] = expiring.map((lease) => {
    const propId = unitProperty.get(lease.unitId)
    return {
      ...lease,
      unitLabel: unitLabel.get(lease.unitId) ?? 'Unit',
      propertyName: propId ? propertyName.get(propId) : undefined,
    }
  })

  const occupied = rows.filter((r) => r.status === 'OCCUPIED').length
  const total = rows.length
  const occupancyPct = total > 0 ? Math.round((occupied / total) * 100) : 0
  const monthlyRent = totalMonthlyRent(rows)

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader
        title="Rent roll"
        subtitle="Occupancy, tenants, and monthly rent across the portfolio, in preview."
      />

      {units.length === 0 ? (
        <EmptyState
          icon={<ReceiptText />}
          title="No units to report yet"
          body="Add units to a property, then record tenancies to see rent, occupancy, and lease-expiration alerts here."
        />
      ) : (
        <>
          {/* Metric strip */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Monthly rent" value={formatMoney(monthlyRent)} />
            <Metric label="Occupied units" value={`${occupied} / ${total}`} />
            <Metric label="Occupancy" value={`${occupancyPct}%`} />
          </div>

          <ExpiringLeases leases={expiringRows} withinDays={WITHIN_DAYS} />

          <Card>
            <CardHeader>
              <CardTitle>Rent roll</CardTitle>
            </CardHeader>
            <CardContent>
              <RentRollTable rows={rows} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {value}
        </span>
      </CardContent>
    </Card>
  )
}
