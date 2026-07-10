import { RefreshCw } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Static mock of the upcoming recurring-rent-invoice feature (Track P3) — demo-workspace
// only, presentational, no data layer. Delete this file + its Sidebar entry when P3 ships.
const DRAFTS = [
  { tenant: 'Familie Berger', unit: 'Top 1 · Ringstrasse Residenz', amount: '€1,250' },
  { tenant: 'Cafe Sonne GmbH', unit: 'Shop EG · Mariahilfer Hof', amount: '€2,400' },
]

export default async function PreviewRentAutomationPage() {
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Rent automation"
        subtitle="One click, one invoice per active lease."
        actions={<Badge variant="muted">Planned — preview</Badge>}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Generate July 2026</CardTitle>
          <Button disabled variant="outline" size="sm">
            <RefreshCw className="size-4" />
            Generate
          </Button>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            2 active leases have rent due this month. Generating creates a draft invoice
            for each — nothing sends until you review and approve them.
          </p>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-4">Tenant</TableHead>
                  <TableHead className="px-4">Unit</TableHead>
                  <TableHead className="px-4 text-right">Draft amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DRAFTS.map((d) => (
                  <TableRow key={d.tenant}>
                    <TableCell className="px-4 py-3 font-medium">{d.tenant}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{d.unit}</TableCell>
                    <TableCell className="px-4 py-3 text-right tabular-nums">{d.amount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        The real version reads each tenancy&rsquo;s rent amount and creates DRAFT
        invoices you review before sending — never auto-sent, always a human in the loop.
      </p>
    </div>
  )
}
