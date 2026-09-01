'use client'

import { selectClassName } from '@/components/ui/native-select'
import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import type { PropertyOption } from '@/components/announcements/NewAnnouncementDialog'

const SELECT_CLASS = selectClassName

// Manager-only "Edit announcement" dialog — the same form as NewAnnouncementDialog,
// pre-filled, posting to updateAnnouncementAction (bound to the announcement id by the
// server page). Edits content/audience only; the publish/draft flip stays its own
// explicit action on the card, so editing a live notice keeps it live. Closes
// optimistically on submit (the house dialog pattern); the action redirects back with
// ?error= on failure, surfaced by the page's ErrorToast.
export function EditAnnouncementDialog({
  action,
  properties,
  announcement,
}: {
  action: (formData: FormData) => void | Promise<void>
  properties: PropertyOption[]
  announcement: { id: string; title: string; body: string; propertyId: string | null }
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Pencil />
            Edit
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit announcement</DialogTitle>
          <DialogDescription>
            Changes to a published notice go live on the resident portal immediately;
            a draft stays a draft.
          </DialogDescription>
        </DialogHeader>

        {/* key on open so a cancelled edit re-opens with the saved values, not the
            abandoned ones (defaultValue only applies on mount). */}
        <form
          key={open ? 'open' : 'closed'}
          action={action}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-3.5"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-title-${announcement.id}`}>Title</Label>
            <Input
              id={`edit-title-${announcement.id}`}
              name="title"
              required
              maxLength={200}
              defaultValue={announcement.title}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-body-${announcement.id}`}>Notice</Label>
            <Textarea
              id={`edit-body-${announcement.id}`}
              name="body"
              required
              rows={5}
              maxLength={4000}
              defaultValue={announcement.body}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-propertyId-${announcement.id}`}>Scope</Label>
            <select
              id={`edit-propertyId-${announcement.id}`}
              name="propertyId"
              defaultValue={announcement.propertyId ?? ''}
              className={SELECT_CLASS}
            >
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
            <SubmitButton pendingLabel="Saving">Save changes</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
