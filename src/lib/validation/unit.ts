import { z } from 'zod'

export const occupancyTypeEnum = z.enum(['LONG_TERM', 'SHORT_TERM', 'VACANT', 'MIXED'])
export const unitStatusEnum = z.enum(['OCCUPIED', 'VACANT', 'MAINTENANCE', 'BLOCKED'])

export const unitFormSchema = z.object({
  label: z.string().min(1, 'Label is required').max(50),
  floor: z.string().nullable().optional(),
  staircase: z.string().nullable().optional(),
  // Numeric optionals. The action parses `formData.get('sizeM2') || null`, which maps
  // both "" AND "0" to null — for size/room-count, 0 is not a meaningful value (a unit
  // is never 0 m2 or 0 rooms), so treating "0" as "unset" is acceptable. `.positive()`
  // then rejects any negative/zero value that reaches the schema by other means.
  sizeM2: z.coerce.number().positive().nullable().optional(),
  roomCount: z.coerce.number().positive().nullable().optional(),
  occupancyType: occupancyTypeEnum,
  // Editable only on the edit path (createUnitAction ignores it and forces VACANT on
  // create). The form supplies a select defaultValue rather than the schema carrying a
  // default, so this stays a required enum here.
  status: unitStatusEnum,
  accessNotes: z.string().nullable().optional(),
  wifiInfo: z.string().nullable().optional(),
  heatingInfo: z.string().nullable().optional(),
  generalNotes: z.string().nullable().optional(),
})

export type UnitFormValues = z.infer<typeof unitFormSchema>
