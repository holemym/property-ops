import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import { reportIssueAction } from '../actions'

const CATEGORIES = ticketCategoryEnum.options

// Shared graphite select styling — matches the operator ticket detail selects. Native
// <select> is kept (no client JS) so optgroups and no-JS server-form posting work.
const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

export default async function ReportIssuePage() {
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

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
      <div className="flex flex-col">
        <PageHeader
          title="Report an issue"
          subtitle="Tell us what needs attention and where."
        />
        <EmptyState
          icon={<Building2 />}
          title="Nothing to report against yet"
          body="No properties are set up in this workspace. Reach out to your property manager to get started."
          action={<Button render={<Link href="/portal" />} nativeButton={false}>Back to my requests</Button>}
        />
      </div>
    )
  }

  const unitsByProperty = properties.map((p) => ({
    property: p,
    units: units.filter((u) => u.property_id === p.id),
  }))

  return (
    <div className="flex flex-col">
      <ErrorToast />

      <PageHeader
        title="Report an issue"
        subtitle="Tell us what needs attention and where."
      />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Request details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={reportIssueAction} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">What&apos;s the issue?</Label>
              <Input
                id="title"
                name="title"
                required
                placeholder="e.g. Kitchen tap is leaking"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="description">Describe it</Label>
              <Textarea
                id="description"
                name="description"
                required
                placeholder="Add any details that help us understand the problem."
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" defaultValue="OTHER" className={SELECT_CLASS}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="propertyId">Property</Label>
                <select
                  id="propertyId"
                  name="propertyId"
                  defaultValue={properties[0]?.id ?? ''}
                  className={SELECT_CLASS}
                  required
                >
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="unitId">Unit (optional)</Label>
                <select id="unitId" name="unitId" defaultValue="" className={SELECT_CLASS}>
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
            </div>

            <div className="flex items-center gap-2 pt-1">
              <SubmitButton pendingLabel="Submitting">Submit request</SubmitButton>
              <Button variant="ghost" render={<Link href="/portal" />} nativeButton={false}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
