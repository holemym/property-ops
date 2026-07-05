import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { occupancyTypeEnum } from '@/lib/validation/unit'
import type { Unit } from '@/lib/data/units'
import type { Property } from '@/lib/data/properties'

const OCCUPANCY_TYPES = occupancyTypeEnum.options

export function UnitForm({
  action,
  properties,
  defaultValues,
  submitLabel,
  readOnly = false,
}: {
  action: (formData: FormData) => void | Promise<void>
  properties: Pick<Property, 'id' | 'name'>[]
  defaultValues?: Partial<Unit>
  submitLabel: string
  readOnly?: boolean
}) {
  // The property select is disabled when editing (defaultValues present): a unit's
  // property_id is immutable after creation. Moving a unit across properties is out of
  // MVP scope, and the composite FK would also require workspace consistency. The
  // hidden input keeps property_id available in the form payload for the create path;
  // on edit the update action never reads it.
  const isEdit = Boolean(defaultValues?.id)

  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <div>
        <Label htmlFor="propertyId">Property</Label>
        <select
          id="propertyId"
          name="propertyId"
          defaultValue={defaultValues?.property_id ?? properties[0]?.id ?? ''}
          className="h-9 w-full rounded-md border px-2 text-sm"
          required
          disabled={readOnly || isEdit}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="label">Label</Label>
        <Input id="label" name="label" defaultValue={defaultValues?.label ?? ''} required disabled={readOnly} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="floor">Floor</Label>
          <Input id="floor" name="floor" defaultValue={defaultValues?.floor ?? ''} disabled={readOnly} />
        </div>
        <div>
          <Label htmlFor="staircase">Staircase</Label>
          <Input id="staircase" name="staircase" defaultValue={defaultValues?.staircase ?? ''} disabled={readOnly} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sizeM2">Size (m²)</Label>
          <Input
            id="sizeM2"
            name="sizeM2"
            type="number"
            step="any"
            defaultValue={defaultValues?.size_m2 ?? ''}
            disabled={readOnly}
          />
        </div>
        <div>
          <Label htmlFor="roomCount">Rooms</Label>
          <Input
            id="roomCount"
            name="roomCount"
            type="number"
            defaultValue={defaultValues?.room_count ?? ''}
            disabled={readOnly}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="occupancyType">Occupancy type</Label>
        <select
          id="occupancyType"
          name="occupancyType"
          defaultValue={defaultValues?.occupancy_type ?? OCCUPANCY_TYPES[0]}
          className="h-9 w-full rounded-md border px-2 text-sm"
          disabled={readOnly}
        >
          {OCCUPANCY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="accessNotes">Access notes</Label>
        <Textarea id="accessNotes" name="accessNotes" defaultValue={defaultValues?.access_notes ?? ''} disabled={readOnly} />
      </div>

      <div>
        <Label htmlFor="wifiInfo">Wifi info</Label>
        <Input id="wifiInfo" name="wifiInfo" defaultValue={defaultValues?.wifi_info ?? ''} disabled={readOnly} />
      </div>

      <div>
        <Label htmlFor="heatingInfo">Heating info</Label>
        <Input id="heatingInfo" name="heatingInfo" defaultValue={defaultValues?.heating_info ?? ''} disabled={readOnly} />
      </div>

      <div>
        <Label htmlFor="generalNotes">General notes</Label>
        <Textarea id="generalNotes" name="generalNotes" defaultValue={defaultValues?.general_notes ?? ''} disabled={readOnly} />
      </div>

      {!readOnly && (
        <div>
          <Button type="submit">{submitLabel}</Button>
        </div>
      )}
    </form>
  )
}
