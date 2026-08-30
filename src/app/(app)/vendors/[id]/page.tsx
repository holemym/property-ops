import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Ticket as TicketIcon } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { getVendor } from '@/lib/data/vendors'
import { listTickets } from '@/lib/data/tickets'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { formatDate } from '@/lib/format-date'
import { VendorForm } from '@/components/vendors/VendorForm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/common/FormError'
import { ConfirmSubmit } from '@/components/common/ConfirmSubmit'
import { updateVendorAction, toggleVendorActiveAction } from '../actions'

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string }>
}) {
  const { id } = await params
  const { error } = await searchParams
  const user = await requirePermission('vendors:read')
  const supabase = await createClient()
  const vendor = await getVendor(supabase, user.workspaceId, id)
  if (!vendor) notFound()

  const canWrite = can(user.role, 'vendors:write')
  const boundUpdate = updateVendorAction.bind(null, id)
  const boundToggle = toggleVendorActiveAction.bind(null, id, !vendor.is_active)

  // The vendor's actual work — the data layer always supported this filter; the page
  // just never showed it, leaving the vendor record a form in a void.
  const assignedTickets = await listTickets(supabase, user.workspaceId, { assignedVendorId: id })

  return (
    <div className="flex flex-col gap-6">
      <Link href="/vendors" className="w-fit text-sm text-muted-foreground transition-colors hover:text-foreground">
        ← Vendors
      </Link>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{vendor.company_name}</h1>
          <Badge variant={vendor.is_active ? 'secondary' : 'outline'}>
            {vendor.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        {canWrite &&
          (vendor.is_active ? (
            <ConfirmSubmit
              action={boundToggle}
              triggerLabel="Mark inactive"
              title="Mark this vendor inactive?"
              description="They'll stop appearing in vendor pickers for new assignments. Existing tickets keep their history, and you can reactivate them anytime."
              confirmLabel="Mark inactive"
            />
          ) : (
            <form action={boundToggle}>
              <Button type="submit" variant="outline">
                Mark active
              </Button>
            </form>
          ))}
      </div>

      <FormError message={error} />

      <VendorForm
        action={boundUpdate}
        defaultValues={vendor}
        submitLabel="Save changes"
        readOnly={!canWrite}
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Assigned tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {assignedTickets.length === 0 ? (
            <EmptyState
              icon={<TicketIcon />}
              title="No tickets assigned"
              body="Tickets assigned to this vendor will appear here."
            />
          ) : (
            <ul className="flex flex-col divide-y">
              {assignedTickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <StatusBadge kind="ticket_status" value={t.status} />
                      <span className="text-xs text-muted-foreground">{formatDate(t.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
