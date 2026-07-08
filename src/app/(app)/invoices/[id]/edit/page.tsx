import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { getInvoice, listInvoiceLines } from '@/lib/data/invoices'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listVendors } from '@/lib/data/vendors'
import { listTickets } from '@/lib/data/tickets'
import { listTenancies } from '@/lib/data/tenancies'
import { PageHeader } from '@/components/layout/PageHeader'
import { ErrorToast } from '@/components/common/ErrorToast'
import { InvoiceForm, type InvoiceFormDefaults } from '@/components/invoices/InvoiceForm'
import { buildAttributionOptions } from '../../attribution'
import { updateInvoiceAction } from '../../actions'

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requirePermission('finance:write')
  const supabase = await createClient()

  const invoice = await getInvoice(supabase, user.workspaceId, id)
  if (!invoice) notFound()

  const [lines, properties, units, vendors, tickets, tenancies] = await Promise.all([
    listInvoiceLines(supabase, user.workspaceId, id),
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listVendors(supabase, user.workspaceId),
    listTickets(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
  ])

  const opts = buildAttributionOptions({ properties, units, vendors, tickets, tenancies })

  const defaults: InvoiceFormDefaults = {
    partyType: invoice.party_type,
    partyName: invoice.party_name,
    direction: invoice.direction,
    currency: invoice.currency,
    taxRate: String(invoice.tax_rate),
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date ?? '',
    recipientEmail: invoice.recipient_email ?? '',
    notes: invoice.notes ?? '',
    propertyId: invoice.property_id ?? '',
    unitId: invoice.unit_id ?? '',
    tenancyId: invoice.tenancy_id ?? '',
    vendorId: invoice.vendor_id ?? '',
    ticketId: invoice.ticket_id ?? '',
    lines:
      lines.length > 0
        ? lines.map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unitAmount: String(l.unit_amount),
          }))
        : undefined,
  }

  const boundUpdate = updateInvoiceAction.bind(null, id)

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />
      <PageHeader
        title={`Edit ${invoice.invoice_number}`}
        subtitle="Update the invoice header and its line items."
      />
      <InvoiceForm
        action={boundUpdate}
        defaults={defaults}
        submitLabel="Save changes"
        properties={opts.properties}
        units={opts.units}
        tenancies={opts.tenancies}
        vendors={opts.vendors}
        tickets={opts.tickets}
      />
    </div>
  )
}
