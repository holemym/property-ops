'use client'

import { useState } from 'react'
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

type UnitOption = { id: string; label: string; propertyName: string }

// Manager-only "New tenancy" dialog. A minimal form posting to createTenancyAction:
// unit select (scoped to the workspace units, grouped by property), tenant name, start
// date, and optional end date / contact / rent / notes. The action redirects back with
// ?error= on failure (surfaced by the page's ErrorToast); on success revalidates the
// page, so we just let the form submit and close optimistically.
export function NewTenancyDialog({
  action,
  units,
}: {
  action: (formData: FormData) => void | Promise<void>
  units: UnitOption[]
}) {
  const [open, setOpen] = useState(false)

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
              defaultValue={units[0]?.id ?? ''}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.propertyName} · {u.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tenantName">Tenant name</Label>
            <Input id="tenantName" name="tenantName" required maxLength={120} />
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
