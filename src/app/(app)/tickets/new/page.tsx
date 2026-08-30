import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { ticketCategoryEnum, ticketPriorityEnum } from '@/lib/validation/ticket'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { EmptyState } from '@/components/common/EmptyState'
import { createTicketAction } from '../actions'

const CATEGORIES = ticketCategoryEnum.options
const PRIORITIES = ticketPriorityEnum.options

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; propertyId?: string; unitId?: string }>
}) {
  const user = await requirePermission('tickets:write')
  const { error, propertyId: prefillPropertyId, unitId: prefillUnitId } = await searchParams
  const supabase = await createClient()
  // Only ACTIVE properties are selectable. Units are loaded for ALL properties and
  // grouped by property in a single flat <optgroup> select (no client JS) — the operator
  // picks a property and (optionally) a unit; the action re-validates that the chosen
  // unit belongs to the chosen property, so a cross-property pairing is rejected server
  // side. A client-JS dependent select is a post-MVP UX improvement.
  const [properties, units] = await Promise.all([
    listProperties(supabase, user.workspaceId, { status: 'ACTIVE' }),
    listUnits(supabase, user.workspaceId),
  ])

  if (properties.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New ticket" />
        <EmptyState
          icon={<Building2 />}
          title="Add a property first"
          body="You need at least one active property before you can create a ticket."
          action={<Button render={<Link href="/properties/new" />} nativeButton={false}>Add a property</Button>}
        />
      </div>
    )
  }

  // Group units under their property for the optgroup-labeled unit select. Only units
  // whose property is in the active list are offered.
  const unitsByProperty = properties.map((p) => ({
    property: p,
    units: units.filter((u) => u.property_id === p.id),
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New ticket"
        subtitle="Log a maintenance request against a property or unit."
      />

      <FormError message={error} />

      <form action={createTicketAction} className="flex max-w-2xl flex-col gap-4">
        <div>
          <Label htmlFor="title">Title</Label>
          <Input id="title" name="title" required />
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea id="description" name="description" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="category">Category</Label>
            <select
              id="category"
              name="category"
              defaultValue="OTHER"
              className="h-9 w-full rounded-md border px-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="priority">Priority</Label>
            <select
              id="priority"
              name="priority"
              defaultValue="NORMAL"
              className="h-9 w-full rounded-md border px-2 text-sm"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="propertyId">Property</Label>
          <select
            id="propertyId"
            name="propertyId"
            // Prefill from ?propertyId= (unit/property hub "New ticket" buttons). An
            // unknown id falls back to the first property; the action re-validates the
            // property/unit pairing server-side either way.
            defaultValue={
              (prefillPropertyId && properties.some((p) => p.id === prefillPropertyId)
                ? prefillPropertyId
                : properties[0]?.id) ?? ''
            }
            className="h-9 w-full rounded-md border px-2 text-sm"
            required
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="unitId">Unit (optional)</Label>
          <select
            id="unitId"
            name="unitId"
            defaultValue={
              prefillUnitId && units.some((u) => u.id === prefillUnitId) ? prefillUnitId : ''
            }
            className="h-9 w-full rounded-md border px-2 text-sm"
          >
            <option value="">No specific unit</option>
            {unitsByProperty.map(
              ({ property, units: propUnits }) =>
                propUnits.length > 0 && (
                  <optgroup key={property.id} label={property.name}>
                    {propUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </optgroup>
                )
            )}
          </select>
        </div>

        <div>
          <Button type="submit">Create ticket</Button>
        </div>
      </form>
    </div>
  )
}
