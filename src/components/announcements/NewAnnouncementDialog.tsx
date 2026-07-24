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
import { Textarea } from '@/components/ui/textarea'
import { SubmitButton } from '@/components/tickets/SubmitButton'

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

export type PropertyOption = { id: string; label: string }

// Manager-only "New announcement" dialog. Posts to createAnnouncementAction (a server
// action): title, body, and an optional property scope (workspace-wide when left at
// "Workspace-wide"). The announcement is always composed as a DRAFT — publishing is a
// separate, explicit action on the list below, mirroring the UploadDocumentDialog
// pattern (close optimistically on submit; the action revalidates + redirects back
// with ?error= on failure, surfaced by the page's ErrorToast).
export function NewAnnouncementDialog({
  action,
  properties,
}: {
  action: (formData: FormData) => void | Promise<void>
  properties: PropertyOption[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Plus />
            New announcement
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New announcement</DialogTitle>
          <DialogDescription>
            Composed as a draft. Publish it separately to make it visible to residents.
          </DialogDescription>
        </DialogHeader>

        <form action={action} onSubmit={() => setOpen(false)} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="body">Notice</Label>
            <Textarea id="body" name="body" required rows={5} maxLength={4000} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="propertyId">Scope</Label>
            <select id="propertyId" name="propertyId" defaultValue="" className={SELECT_CLASS}>
              <option value="">Workspace-wide</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Saving">Save draft</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
