import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import type { Tenant } from '@/lib/data/tenants'

// Mirrors VendorForm's shape: a plain server-action-bound <form>, optional
// defaultValues for edit mode, and a readOnly mode that disables every field and
// hides the submit button (used when the viewer holds tenants:read but not
// tenants:write).
export function TenantForm({
  action,
  defaultValues,
  submitLabel,
  readOnly = false,
}: {
  action: (formData: FormData) => void | Promise<void>
  defaultValues?: Partial<Tenant>
  submitLabel: string
  readOnly?: boolean
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input
          id="fullName"
          name="fullName"
          defaultValue={defaultValues?.full_name ?? ''}
          required
          disabled={readOnly}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={defaultValues?.email ?? ''} disabled={readOnly} />
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" defaultValue={defaultValues?.phone ?? ''} disabled={readOnly} />
        </div>
      </div>

      <div>
        <Label htmlFor="language">Language</Label>
        <Input
          id="language"
          name="language"
          placeholder="e.g. de, en"
          defaultValue={defaultValues?.language ?? ''}
          disabled={readOnly}
        />
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ''} disabled={readOnly} />
      </div>

      {!readOnly && (
        <div>
          <Button type="submit">{submitLabel}</Button>
        </div>
      )}
    </form>
  )
}
