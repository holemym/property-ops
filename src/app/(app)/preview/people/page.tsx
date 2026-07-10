import { Contact, Mail, Phone, DoorOpen } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

// Static mock of the upcoming tenant-directory feature (Track P1) — demo-workspace only,
// presentational, no data layer. Delete this file + its Sidebar entry when P1 ships.
const TENANTS = [
  {
    name: 'Familie Berger',
    unit: 'Top 1 · Ringstrasse Residenz',
    since: 'Tenant since Jan 2025',
    email: 'berger@example.com',
    phone: '+43 660 000 0000',
  },
  {
    name: 'Cafe Sonne GmbH',
    unit: 'Shop EG · Mariahilfer Hof',
    since: 'Tenant since Jun 2025, lease ends in 45 days',
    email: 'kontakt@cafesonne.example',
    phone: '+43 660 111 1111',
  },
]

export default async function PreviewPeoplePage() {
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="People"
        subtitle="Every tenant, as a real contact — not just a name on a lease."
        actions={<Badge variant="muted">Planned — preview</Badge>}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {TENANTS.map((t) => (
          <Card key={t.name}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Contact className="size-5" />
              </div>
              <div>
                <p className="font-medium text-foreground">{t.name}</p>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <DoorOpen className="size-3.5" /> {t.unit}
                </p>
                <p className="text-xs text-muted-foreground">{t.since}</p>
              </div>
              <div className="flex flex-col gap-1 border-t pt-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Mail className="size-3.5" /> {t.email}
                </span>
                <span className="flex items-center gap-1.5">
                  <Phone className="size-3.5" /> {t.phone}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        The real version links each contact to their tenancy history and tickets, so a
        tenant is a person you can reach, not just a name on a lease record.
      </p>
    </div>
  )
}
