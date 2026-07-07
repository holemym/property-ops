import { Users } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import type { Tenancy } from '@/types/domain'
import { formatMoney, formatSpan, tenancyPhase, type TenancyPhase } from './shared'

// The unit's tenancy history: every tenancy for this unit, current-first then upcoming,
// then past (most recent first within each). Each row shows the tenant, the span, rent,
// and a phase pill (current / upcoming / past).

const PHASE_LABEL: Record<TenancyPhase, string> = {
  current: 'Current',
  upcoming: 'Upcoming',
  past: 'Past',
}

const PHASE_VARIANT: Record<TenancyPhase, 'green' | 'blue' | 'muted'> = {
  current: 'green',
  upcoming: 'blue',
  past: 'muted',
}

// Sort key: current (0) → upcoming (1) → past (2). Within current/upcoming, soonest
// start first; within past, most-recently-ended first.
const PHASE_ORDER: Record<TenancyPhase, number> = { current: 0, upcoming: 1, past: 2 }

export function TenancyHistoryCard({
  tenancies,
  today,
}: {
  tenancies: Tenancy[]
  today: string
}) {
  const rows = tenancies
    .map((t) => ({ tenancy: t, phase: tenancyPhase(t.start_date, t.end_date, today) }))
    .sort((a, b) => {
      const byPhase = PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase]
      if (byPhase !== 0) return byPhase
      if (a.phase === 'past') {
        // Most recently ended first (null end sorts as "still latest").
        const ae = a.tenancy.end_date ?? '9999-12-31'
        const be = b.tenancy.end_date ?? '9999-12-31'
        return ae < be ? 1 : ae > be ? -1 : 0
      }
      // current / upcoming: soonest start first
      return a.tenancy.start_date < b.tenancy.start_date ? -1 : 1
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tenancy history</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="No tenancies recorded"
            body="Record a tenancy to track who occupies this unit and when."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/5">
            {rows.map(({ tenancy, phase }) => (
              <li
                key={tenancy.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {tenancy.tenant_name}
                    </span>
                    <Badge variant={PHASE_VARIANT[phase]}>{PHASE_LABEL[phase]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatSpan(tenancy.start_date, tenancy.end_date)}
                  </div>
                </div>
                <div className="text-sm font-medium text-foreground tabular-nums">
                  {tenancy.rent_amount != null
                    ? `${formatMoney(tenancy.rent_amount)} / mo`
                    : '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
