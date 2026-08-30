'use client'

import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import type { Tenant } from '@/lib/data/tenants'

type UnitOption = { id: string; label: string; propertyName: string }
type TenantOption = Pick<Tenant, 'id' | 'full_name'>

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

// Manager-only "New tenancy" dialog. A minimal form posting to createTenancyAction:
// unit select (scoped to the workspace units, grouped by property), an optional
// directory-person picker (P1-3), tenant name, start date, and optional end date /
// contact / rent / notes. The action redirects back with ?error= on failure (surfaced
// by the page's ErrorToast); on success revalidates the page, so we just let the form
// submit and close optimistically.
export function NewTenancyDialog({
  action,
  units,
  tenants,
  defaultUnitId,
}: {
  action: (formData: FormData) => void | Promise<void>
  units: UnitOption[]
  tenants: TenantOption[]
  /** Preselects the unit — set when the dialog is hosted on a unit's own hub. */
  defaultUnitId?: string
}) {
  const [open, setOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Selecting a directory person previews their name in the free-text field below —
  // pure UX convenience. createTenancy always RE-resolves tenant_name from tenant_id
  // server-side (never trusts this client value, see the CRITICAL comment there), so
  // the field is locked read-only while a person is linked rather than let someone
  // edit a name that would be silently discarded on save. Plain DOM writes via ref
  // (not React state) keep both fields uncontrolled, matching every other field in
  // this form and React's automatic reset-after-successful-action behavior.
  function handlePersonChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const input = nameInputRef.current
    if (!input) return
    const selected = tenants.find((t) => t.id === e.target.value)
    input.value = selected ? selected.full_name : ''
    input.readOnly = selected != null
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus />
            New tenancy
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New tenancy</DialogTitle>
          <DialogDescription>
            Record an occupied span for a unit. Leave the end date blank for a month-to-month
            tenancy.
          </DialogDescription>
        </DialogHeader>

        <form
          action={action}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-3.5"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="unitId">Unit</Label>
            <select
              id="unitId"
              name="unitId"
              required
              defaultValue={defaultUnitId ?? units[0]?.id ?? ''}
              className={selectClass}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.propertyName} · {u.label}
                </option>
              ))}
            </select>
          </div>

          {tenants.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenantId">Person</Label>
              <select
                id="tenantId"
                name="tenantId"
                defaultValue=""
                onChange={handlePersonChange}
                className={selectClass}
              >
                <option value="">No linked person — enter a name below</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenantName">Tenant name</Label>
            <Input
              ref={nameInputRef}
              id="tenantName"
              name="tenantName"
              required
              maxLength={120}
              className="read-only:bg-muted/50 read-only:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input id="startDate" name="startDate" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="endDate">End date</Label>
              <Input id="endDate" name="endDate" type="date" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenantContact">Contact</Label>
            <Input
              id="tenantContact"
              name="tenantContact"
              type="text"
              maxLength={200}
              placeholder="Email or phone"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rentAmount">Monthly rent</Label>
            <Input id="rentAmount" name="rentAmount" type="number" step="any" min="0" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" type="text" />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Saving">Save tenancy</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
