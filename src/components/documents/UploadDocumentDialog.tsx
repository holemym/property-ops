'use client'

import { selectClassName } from '@/components/ui/native-select'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Upload } from 'lucide-react'
import { ALLOWED_DOCUMENT_MIME_TYPES } from '@/lib/validation/document'
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
import { FileInput } from '@/components/ui/file-input'
import { SubmitButton } from '@/components/tickets/SubmitButton'
import type { DocumentType } from '@/types/domain'

const SELECT_CLASS = selectClassName

// The eight document types, paired with a sentence-case label for the select.
const TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'LEASE', label: 'Lease' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'PERMIT', label: 'Permit' },
  { value: 'CERTIFICATE', label: 'Certificate' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'ID', label: 'ID' },
  { value: 'INVOICE', label: 'Invoice' },
  { value: 'OTHER', label: 'Other' },
]

export type EntityOption = { id: string; label: string }
export type EntityOptions = {
  properties: EntityOption[]
  units: EntityOption[]
  tenancies: EntityOption[]
  vendors: EntityOption[]
}

// The entity kinds a document can attach to. Each maps to one link field the action reads
// (propertyId / unitId / tenancyId / vendorId). We post only the field for the chosen
// kind, so at most one link is set — matching the single-entity-link model in 0018.
const ATTACH_KINDS = [
  { key: 'property', field: 'propertyId', label: 'Property', list: 'properties' },
  { key: 'unit', field: 'unitId', label: 'Unit', list: 'units' },
  { key: 'tenancy', field: 'tenancyId', label: 'Tenancy', list: 'tenancies' },
  { key: 'vendor', field: 'vendorId', label: 'Vendor', list: 'vendors' },
] as const

type AttachKey = (typeof ATTACH_KINDS)[number]['key'] | ''

// The exact server allowlist (src/lib/validation/document.ts), joined for the HTML
// accept= hint — importing the const (rather than restating the list) makes drift
// between what the picker offers and what the server accepts impossible.
const ACCEPT_ATTR = ALLOWED_DOCUMENT_MIME_TYPES.join(',')

// Detects the enclosing form's pending -> settled transition and fires onSettled once.
// Rendered INSIDE the <form> (useFormStatus only reads the nearest form's status).
function FormSettledWatcher({ onSettled }: { onSettled: () => void }) {
  const { pending } = useFormStatus()
  const wasPending = useRef(false)
  useEffect(() => {
    if (wasPending.current && !pending) onSettled()
    wasPending.current = pending
  }, [pending, onSettled])
  return null
}

// Manager-only "Upload document" dialog. Posts to uploadDocumentAction (a server action):
// title, document_type, an optional attach-to (an entity-kind select + a dependent id
// select, so only one link field is submitted), an optional expiry date, and the file.
// The action revalidates + redirects back with ?error= on failure (surfaced by the page's
// ErrorToast).
//
// DELIBERATE DEVIATION from the house close-optimistically-on-submit dialog pattern
// (NewAnnouncementDialog & co): this is the one form that ships a multi-megabyte
// multipart body through the server action, so an optimistic close left NO pending
// feedback for the seconds a 10 MB file takes — the dialog vanished and nothing said
// the upload was still running. Instead the dialog stays OPEN with the SubmitButton in
// its pending state, and FormSettledWatcher closes it when the action settles (success
// redirect and ?error= redirect both end the pending transition).
export function UploadDocumentDialog({
  action,
  entities,
}: {
  action: (formData: FormData) => void | Promise<void>
  entities: EntityOptions
}) {
  const [open, setOpen] = useState(false)
  const [attachKind, setAttachKind] = useState<AttachKey>('')

  const selected = useMemo(
    () => ATTACH_KINDS.find((k) => k.key === attachKind),
    [attachKind]
  )
  const idOptions = selected ? entities[selected.list] : []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm">
            <Upload />
            Upload document
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Store a lease, permit, certificate, or invoice. Attach it to a property, unit,
            tenancy, or vendor, or leave it workspace-wide. Attaching to a tenancy shares
            the document with that resident (even after the lease ends); attaching to a
            unit or property shares it with the current residents there — vendor-attached
            and unattached documents stay visible to operators only.
          </DialogDescription>
        </DialogHeader>

        <form action={action} encType="multipart/form-data" className="flex flex-col gap-3.5">
          <FormSettledWatcher onSettled={() => setOpen(false)} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="documentType">Type</Label>
            <select
              id="documentType"
              name="documentType"
              required
              defaultValue="LEASE"
              className={SELECT_CLASS}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachKind">Attach to</Label>
              <select
                id="attachKind"
                value={attachKind}
                onChange={(e) => setAttachKind(e.target.value as AttachKey)}
                className={SELECT_CLASS}
              >
                <option value="">Nothing</option>
                {ATTACH_KINDS.map((k) => (
                  <option key={k.key} value={k.key} disabled={entities[k.list].length === 0}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attachId">Which one</Label>
              {/* Post the id under the selected kind's field name so exactly one link is
                  set; when nothing is attached, no link field is submitted at all. */}
              <select
                id="attachId"
                name={selected?.field}
                required={Boolean(selected)}
                disabled={!selected}
                className={SELECT_CLASS}
                key={attachKind}
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
            <Label htmlFor="expiresAt">Expiry date</Label>
            <Input id="expiresAt" name="expiresAt" type="date" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">File</Label>
            <FileInput id="file" name="file" accept={ACCEPT_ATTR} required />
          </div>

          <DialogFooter className="-mx-4 -mb-4 mt-1">
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <SubmitButton pendingLabel="Uploading">Upload document</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
