import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listVendors } from '@/lib/data/vendors'
import { listTickets } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorToast } from '@/components/common/ErrorToast'
import { InvoiceForm } from '@/components/invoices/InvoiceForm'
import { buildAttributionOptions } from '../attribution'
import { createInvoiceAction } from '../actions'

export default async function NewInvoicePage() {
  const user = await requirePermission('finance:write')
  const supabase = await createClient()

  const [properties, units, vendors, tickets, tenancies] = await Promise.all([
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listVendors(supabase, user.workspaceId),
    listTickets(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
  ])

  const opts = buildAttributionOptions({ properties, units, vendors, tickets, tenancies })

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader title="New invoice" subtitle="Raise a bill and add its line items." />
      <InvoiceForm
        action={createInvoiceAction}
        submitLabel="Create invoice"
        properties={opts.properties}
        units={opts.units}
        tenancies={opts.tenancies}
        vendors={opts.vendors}
        tickets={opts.tickets}
      />
    </div>
  )
}
