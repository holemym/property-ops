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
import type { IncomeCategory, ExpenseCategory } from '@/types/domain'
import { humanizeCategory } from './shared'

// Manager/accountant-only entry dialogs. Each posts a plain FormData to the matching
// server action (createIncomeAction / createExpenseAction), which redirects back with
// ?error= on failure (surfaced by the page's ErrorToast) or revalidates on success. The
// forms close optimistically on submit — the same pattern as NewTenancyDialog.

export type UnitOption = { id: string; label: string; propertyName: string }

const selectClass =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

// A shared "unit (optional)" select — the first option leaves the entry at portfolio
// level (no unit). Grouped by property for context.
function UnitSelect({ units }: { units: UnitOption[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="unitId">Unit</Label>
      <select id="unitId" name="unitId" defaultValue="" className={selectClass}>
        <option value="">Portfolio (no unit)</option>
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.propertyName} · {u.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AddIncomeDialog({
  action,
  units,
  categories,
}: {
  action: (formData: FormData) => void | Promise<void>
  units: UnitOption[]
  categories: IncomeCategory[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus />
            Add income
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add income</DialogTitle>
          <DialogDescription>
            Record income for a unit or the portfolio. Leave the unit blank for a
            portfolio-level entry.
          </DialogDescription>
        </DialogHeader>

        <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amount">Amount (EUR)</Label>
              <Input id="amount" name="amount" type="number" step="any" min="0" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" defaultValue={categories[0]} className={selectClass}>
                {categories.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {humanizeCategory(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <UnitSelect units={units} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="periodStart">Period start</Label>
              <Input id="periodStart" name="periodStart" type="date" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="periodEnd">Period end</Label>
              <Input id="periodEnd" name="periodEnd" type="date" />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" type="text" maxLength={500} />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Saving">Save income</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AddExpenseDialog({
  action,
  units,
  categories,
  tickets,
}: {
  action: (formData: FormData) => void | Promise<void>
  units: UnitOption[]
  categories: ExpenseCategory[]
  tickets: Array<{ id: string; title: string }>
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <Plus />
            Add expense
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>
            Record a non-ticket cost. Link a ticket to attribute the cost to that job; a
            linked expense supersedes the ticket&rsquo;s own cost in analytics.
          </DialogDescription>
        </DialogHeader>

        <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="amount">Amount (EUR)</Label>
              <Input id="amount" name="amount" type="number" step="any" min="0" required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="category">Category</Label>
              <select id="category" name="category" defaultValue={categories[0]} className={selectClass}>
                {categories.map((c) => (
                  <option key={c} value={c} className="capitalize">
                    {humanizeCategory(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <UnitSelect units={units} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="incurredOn">Incurred on</Label>
            <Input id="incurredOn" name="incurredOn" type="date" required />
          </div>

          {tickets.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ticketId">Linked ticket</Label>
              <select id="ticketId" name="ticketId" defaultValue="" className={selectClass}>
                <option value="">None</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Input id="notes" name="notes" type="text" maxLength={500} />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Saving">Save expense</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
