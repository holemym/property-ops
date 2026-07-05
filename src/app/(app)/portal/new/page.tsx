import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { ticketCategoryEnum } from '@/lib/validation/ticket'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/common/EmptyState'
import { reportIssueAction } from '../actions'

const CATEGORIES = ticketCategoryEnum.options

export default async function ReportIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const { error } = await searchParams
  const supabase = await createClient()
  // A tenant CAN list workspace properties/units (properties_select_workspace /
  // units_select_workspace allow any member). Only ACTIVE properties are selectable.
  // Units load for all properties and group by property in an optgroup select (no client
  // JS); the action re-validates the unit belongs to the chosen property. NOTE: NO
  // priority field — tenants cannot set priority; the action forces NORMAL.
  const [properties, units] = await Promise.all([
    listProperties(supabase, user.workspaceId, { status: 'ACTIVE' }),
    listUnits(supabase, user.workspaceId),
  ])

  if (properties.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">Report an Issue</h1>
        <EmptyState
          title="Nothing to report against yet"
          description="There are no properties set up in this workspace. Please contact your property manager."
        />
      </div>
    )
  }

  const unitsByProperty = properties.map((p) => ({
    property: p,
    units: units.filter((u) => u.property_id === p.id),
  }))

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Report an Issue</h1>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <form action={reportIssueAction} className="flex max-w-2xl flex-col gap-4">
        <div>
          <Label htmlFor="title">What&apos;s the issue?</Label>
          <Input id="title" name="title" required />
        </div>

        <div>
          <Label htmlFor="description">Describe it</Label>
          <Textarea id="description" name="description" required />
        </div>

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
          <Label htmlFor="propertyId">Property</Label>
          <select
            id="propertyId"
            name="propertyId"
            defaultValue={properties[0]?.id ?? ''}
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
            defaultValue=""
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
          <Button type="submit">Submit request</Button>
        </div>
      </form>
    </div>
  )
}
