'use client'

import { selectClassName } from '@/components/ui/native-select'
import { useMemo, useState } from 'react'
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
import type { EntityOption, EntityOptions } from './UploadDocumentDialog'

const SELECT_CLASS = selectClassName

// The upload dialog's four attach kinds PLUS ticket: the upload UI never offers a
// ticket link, but the schema/DB allow one, so the EDIT dialog must be able to
// represent (and restate) it — otherwise saving a ticket-attached document would
// silently detach it (the action's replace semantics write all five refs).
const EDIT_ATTACH_KINDS = [
  { key: 'property', field: 'propertyId', label: 'Property', list: 'properties' },
  { key: 'unit', field: 'unitId', label: 'Unit', list: 'units' },
  { key: 'tenancy', field: 'tenancyId', label: 'Tenancy', list: 'tenancies' },
  { key: 'vendor', field: 'vendorId', label: 'Vendor', list: 'vendors' },
  { key: 'ticket', field: 'ticketId', label: 'Ticket', list: 'tickets' },
] as const

type AttachKey = (typeof EDIT_ATTACH_KINDS)[number]['key'] | ''

export type EditEntityOptions = EntityOptions & { tickets: EntityOption[] }

export type EditableDocument = {
  id: string
  title: string
  notes: string | null
  expiresAt: string | null
  propertyId: string | null
  unitId: string | null
  tenancyId: string | null
  vendorId: string | null
  ticketId: string | null
}

function currentAttachKind(doc: EditableDocument): AttachKey {
  if (doc.propertyId) return 'property'
  if (doc.unitId) return 'unit'
  if (doc.tenancyId) return 'tenancy'
  if (doc.vendorId) return 'vendor'
  if (doc.ticketId) return 'ticket'
  return ''
}

function currentAttachId(doc: EditableDocument): string {
  return doc.propertyId ?? doc.unitId ?? doc.tenancyId ?? doc.vendorId ?? doc.ticketId ?? ''
}

// Manager-only per-row "Edit" dialog on the documents table. Edits the METADATA of a
// stored document — title, notes, expiry, and its single attachment (re-attach or
// detach) — never the bytes (append-only by design; there is no delete/replace). The
// attachment is the retract lever: it is what drives resident-portal visibility (RLS
// 0030), so a wrongly-filed lease is moved or detached here. Posts to
// updateDocumentAction (bound to the document id by the server table). Closes
// optimistically on submit, the house dialog pattern (unlike the upload, no
// multi-megabyte body is in flight); failures come back as ?error= via ErrorToast.
export function EditDocumentDialog({
  action,
  entities,
  doc,
}: {
  action: (formData: FormData) => void | Promise<void>
  entities: EditEntityOptions
  doc: EditableDocument
}) {
  const [open, setOpen] = useState(false)
  const [attachKind, setAttachKind] = useState<AttachKey>(() => currentAttachKind(doc))

  const selected = useMemo(
    () => EDIT_ATTACH_KINDS.find((k) => k.key === attachKind),
    [attachKind]
  )
  const idOptions = selected ? entities[selected.list] : []
  const defaultAttachId = selected?.key === currentAttachKind(doc) ? currentAttachId(doc) : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Re-opening after a cancel starts from the SAVED attachment again, not the
        // abandoned selection (the form itself resets via the key below).
        if (next) setAttachKind(currentAttachKind(doc))
      }}
    >
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <Pencil />
            Edit
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit document</DialogTitle>
          <DialogDescription>
            Update the details or move the attachment — attaching to a tenancy, unit, or
            property shares the document with those residents; detaching retracts it to
            operators only. The stored file itself is unchanged.
          </DialogDescription>
        </DialogHeader>

        <form
          key={open ? 'open' : 'closed'}
          action={action}
          onSubmit={() => setOpen(false)}
          className="flex flex-col gap-3.5"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-doc-title-${doc.id}`}>Title</Label>
            <Input
              id={`edit-doc-title-${doc.id}`}
              name="title"
              required
              maxLength={200}
              defaultValue={doc.title}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`edit-doc-attachKind-${doc.id}`}>Attach to</Label>
              <select
                id={`edit-doc-attachKind-${doc.id}`}
                value={attachKind}
                onChange={(e) => setAttachKind(e.target.value as AttachKey)}
                className={SELECT_CLASS}
              >
                <option value="">Nothing</option>
                {EDIT_ATTACH_KINDS.map((k) => (
                  <option key={k.key} value={k.key} disabled={entities[k.list].length === 0}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`edit-doc-attachId-${doc.id}`}>Which one</Label>
              {/* Post the id under the selected kind's field name so exactly one link is
                  set; when nothing is attached, no link field is submitted at all
                  (the action then nulls all five — the detach). */}
              <select
                id={`edit-doc-attachId-${doc.id}`}
                name={selected?.field}
                required={Boolean(selected)}
                disabled={!selected}
                className={SELECT_CLASS}
                key={attachKind}
                defaultValue={defaultAttachId}
              >
                {idOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-doc-expiresAt-${doc.id}`}>Expiry date</Label>
            <Input
              id={`edit-doc-expiresAt-${doc.id}`}
              name="expiresAt"
              type="date"
              defaultValue={doc.expiresAt ?? ''}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`edit-doc-notes-${doc.id}`}>Notes</Label>
            <Textarea
              id={`edit-doc-notes-${doc.id}`}
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={doc.notes ?? ''}
            />
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
