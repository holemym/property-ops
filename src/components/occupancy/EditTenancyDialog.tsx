'use client'

import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
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
import type { Tenancy } from '@/types/domain'
import type { Tenant } from '@/lib/data/tenants'

type TenantOption = Pick<Tenant, 'id' | 'full_name'>

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

// Manager-only per-row "Edit tenancy" dialog — NewTenancyDialog's shape, prefilled from
// the row and posting to a pre-bound updateTenancyAction. The unit is NOT editable (a
// tenancy's unit is immutable, see the action) — it travels as a hidden input only so
// the shared schema's required unitId parses. Ending a tenancy = saving an end date;
// the "End tenancy" shortcut just prefills it with today. Errors come back as ?error=
// on `returnTo` (host's toast/FormError), success as ?tenancy=updated
// (TenancySavedToast), so the form submits and closes optimistically like the create
// dialog.
export function EditTenancyDialog({
  action,
  tenancy,
  tenants,
  returnTo,
  today,
}: {
  /** updateTenancyAction pre-bound to this tenancy's id. */
  action: (formData: FormData) => void | Promise<void>
  tenancy: Tenancy
  tenants: TenantOption[]
  /** The host page's own path — posted so redirects land back here. */
  returnTo: string
  /** Server-computed ISO day, feeding the "End tenancy" shortcut. */
  today: string
}) {
  const [open, setOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const endDateRef = useRef<HTMLInputElement>(null)
  // Tracked only to drive the end-date input's `min` (the start input itself stays
  // uncontrolled — defaultValue + onChange listener).
  const [startDate, setStartDate] = useState(tenancy.start_date)

  // Same DOM-ref person-picker behavior as NewTenancyDialog: selecting a directory
  // person previews their name and locks the free-text field (the server re-resolves
  // the real name from tenant_id either way — see updateTenancy's CRITICAL comment).
  function handlePersonChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const input = nameInputRef.current
    if (!input) return
    const selected = tenants.find((t) => t.id === e.target.value)
    input.value = selected ? selected.full_name : ''
    input.readOnly = selected != null
  }

  // Prefill end date = today (clamped to the start date so a not-yet-started tenancy
  // doesn't get an inverted span the server refine would bounce).
  function endTenancyToday() {
    const input = endDateRef.current
    if (!input) return
    input.value = today >= startDate ? today : startDate
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" aria-label={`Edit tenancy for ${tenancy.tenant_name}`}>
            <Pencil className="size-4" />
            Edit
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit tenancy</DialogTitle>
          <DialogDescription>
            Update the dates, tenant, or rent. To end a tenancy, set its end date — the
            shortcut below fills in today.
          </DialogDescription>
        </DialogHeader>

        <form
          action={action}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-3.5"
        >
          {/* The unit is immutable on edit; posted only to satisfy the shared schema. */}
          <input type="hidden" name="unitId" value={tenancy.unit_id} />
          <input type="hidden" name="returnTo" value={returnTo} />

          {tenants.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-tenantId">Person</Label>
              <select
                id="edit-tenantId"
                name="tenantId"
                defaultValue={tenancy.tenant_id ?? ''}
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
            <Label htmlFor="edit-tenantName">Tenant name</Label>
            <Input
              ref={nameInputRef}
              id="edit-tenantName"
              name="tenantName"
              required
              maxLength={120}
              defaultValue={tenancy.tenant_name}
              readOnly={tenancy.tenant_id != null}
              className="read-only:bg-muted/50 read-only:text-muted-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-startDate">Start date</Label>
              <Input
                id="edit-startDate"
                name="startDate"
                type="date"
                required
                defaultValue={tenancy.start_date}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-endDate">End date</Label>
                <button
                  type="button"
                  onClick={endTenancyToday}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
                >
                  End tenancy
                </button>
              </div>
              <Input
                ref={endDateRef}
                id="edit-endDate"
                name="endDate"
                type="date"
                defaultValue={tenancy.end_date ?? ''}
                min={startDate || undefined}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tenantContact">Contact</Label>
            <Input
              id="edit-tenantContact"
              name="tenantContact"
              type="text"
              maxLength={200}
              placeholder="Email or phone"
              defaultValue={tenancy.tenant_contact ?? ''}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-rentAmount">Monthly rent</Label>
            <Input
              id="edit-rentAmount"
              name="rentAmount"
              type="number"
              step="any"
              min="0"
              defaultValue={tenancy.rent_amount ?? ''}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-notes">Notes</Label>
            <Input id="edit-notes" name="notes" type="text" defaultValue={tenancy.notes ?? ''} />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
