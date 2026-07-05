import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { propertyTypeEnum } from '@/lib/validation/property'
import type { Property } from '@/lib/data/properties'

const PROPERTY_TYPES = propertyTypeEnum.options

export function PropertyForm({
  action,
  defaultValues,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>
  defaultValues?: Partial<Property>
  submitLabel: string
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={defaultValues?.name ?? ''} required />
      </div>

      <div>
        <Label htmlFor="addressLine1">Address</Label>
        <Input
          id="addressLine1"
          name="addressLine1"
          defaultValue={defaultValues?.address_line1 ?? ''}
          required
        />
      </div>

      <div>
        <Label htmlFor="addressLine2">Address line 2</Label>
        <Input
          id="addressLine2"
          name="addressLine2"
          defaultValue={defaultValues?.address_line2 ?? ''}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="city">City</Label>
          <Input id="city" name="city" defaultValue={defaultValues?.city ?? ''} required />
        </div>
        <div>
          <Label htmlFor="postalCode">Postal code</Label>
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={defaultValues?.postal_code ?? ''}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="country">Country</Label>
        <Input id="country" name="country" defaultValue={defaultValues?.country ?? ''} required />
      </div>

      <div>
        <Label htmlFor="propertyType">Type</Label>
        <select
          id="propertyType"
          name="propertyType"
          defaultValue={defaultValues?.property_type ?? PROPERTY_TYPES[0]}
          className="h-9 w-full rounded-md border px-2 text-sm"
        >
          {PROPERTY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={defaultValues?.notes ?? ''} />
      </div>

      <div>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
