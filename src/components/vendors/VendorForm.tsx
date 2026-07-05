import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { vendorCategoryEnum } from '@/lib/validation/vendor'
import type { Vendor } from '@/lib/data/vendors'

const SERVICE_CATEGORIES = vendorCategoryEnum.options

export function VendorForm({
  action,
  defaultValues,
  submitLabel,
  readOnly = false,
}: {
  action: (formData: FormData) => void | Promise<void>
  defaultValues?: Partial<Vendor>
  submitLabel: string
  readOnly?: boolean
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <div>
        <Label htmlFor="companyName">Company name</Label>
        <Input
          id="companyName"
          name="companyName"
          defaultValue={defaultValues?.company_name ?? ''}
          required
          disabled={readOnly}
        />
      </div>

      <div>
        <Label htmlFor="contactName">Contact name</Label>
        <Input
          id="contactName"
          name="contactName"
          defaultValue={defaultValues?.contact_name ?? ''}
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
        <Label htmlFor="serviceCategory">Service category</Label>
        <select
          id="serviceCategory"
          name="serviceCategory"
          defaultValue={defaultValues?.service_category ?? SERVICE_CATEGORIES[0]}
          className="h-9 w-full rounded-md border px-2 text-sm"
          disabled={readOnly}
        >
          {SERVICE_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
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
