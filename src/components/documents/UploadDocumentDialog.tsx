'use client'

import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
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

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

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

// Manager-only "Upload document" dialog. Posts to uploadDocumentAction (a server action):
// title, document_type, an optional attach-to (an entity-kind select + a dependent id
// select, so only one link field is submitted), an optional expiry date, and the file.
// The action revalidates + redirects back with ?error= on failure (surfaced by the page's
// ErrorToast), so we close optimistically on submit.
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
            tenancy, or vendor, or leave it workspace-wide.
          </DialogDescription>
        </DialogHeader>

        <form
          action={action}
          onSubmit={() => setOpen(false)}
          encType="multipart/form-data"
          className="flex flex-col gap-3.5"
        >
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
            <FileInput
              id="file"
              name="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              required
            />
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
