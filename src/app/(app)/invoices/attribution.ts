import type { Property } from '@/lib/data/properties'
import type { Unit } from '@/lib/data/units'
import type { Vendor } from '@/lib/data/vendors'
import type { Ticket } from '@/lib/data/tickets'
import type { Tenancy } from '@/types/domain'
import type { AttributionOption } from '@/components/invoices/InvoiceForm'

// Shared label-building for the invoice form's optional attribution selects. Units get a
// "Property · Label" label so the flat select is unambiguous; tenancies get their tenant name
// (+ unit label when resolvable). Reused by the new and edit pages so both render identical
// option lists.
export function buildAttributionOptions({
  properties,
  units,
  vendors,
  tickets,
  tenancies,
}: {
  properties: Property[]
  units: Unit[]
  vendors: Vendor[]
  tickets: Ticket[]
  tenancies: Tenancy[]
}): {
  properties: AttributionOption[]
  units: AttributionOption[]
  vendors: AttributionOption[]
  tickets: AttributionOption[]
  tenancies: AttributionOption[]
} {
  const propertyName = new Map(properties.map((p) => [p.id, p.name]))
  const unitLabel = new Map(units.map((u) => [u.id, u.label]))

  return {
    properties: properties.map((p) => ({ id: p.id, label: p.name })),
    units: units.map((u) => {
      const prop = propertyName.get(u.property_id)
      return { id: u.id, label: prop ? `${prop} · ${u.label}` : u.label }
    }),
    vendors: vendors.map((v) => ({ id: v.id, label: v.company_name })),
    tickets: tickets.map((t) => ({ id: t.id, label: t.title })),
    tenancies: tenancies.map((t) => {
      const unit = unitLabel.get(t.unit_id)
      return { id: t.id, label: unit ? `${t.tenant_name} · ${unit}` : t.tenant_name }
    }),
  }
}
