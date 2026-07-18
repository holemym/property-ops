'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
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

// "Generate rent" (Track P3, spec §3) — drafts one DRAFT invoice per active tenancy with
// a rent amount for the chosen month; an existing (tenancy, month) invoice is skipped.
// Plain form, not ConfirmSubmit: the result is a batch of reviewable/voidable DRAFT
// invoices, not a destructive action, so no confirm step is warranted (mirrors
// AddIncomeDialog/AddExpenseDialog's plain-form posture).
export function GenerateRentDialog({
  action,
  defaultMonth,
}: {
  action: (formData: FormData) => void | Promise<void>
  defaultMonth: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <RefreshCw className="size-4" />
            Generate rent
          </Button>
        }
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Generate rent invoices</DialogTitle>
          <DialogDescription>
            Drafts one invoice per active tenancy with a rent amount. Existing invoices
            for the month are skipped.
          </DialogDescription>
        </DialogHeader>

        <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="month">Month</Label>
            <Input id="month" name="month" type="month" defaultValue={defaultMonth} required />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Generating">Generate</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
