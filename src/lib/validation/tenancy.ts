import { z } from 'zod'

// v1 accepts calendar dates as ISO `YYYY-MM-DD` (the HTML <input type="date"> format
// and the Postgres `date` column format). We validate the shape with a regex rather
// than z.coerce.date() so the value stays a plain date string end-to-end (no timezone
// shifting from a Date round-trip). start_date is required; end_date is optional/null
// (null = open-ended / month-to-month).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export const tenancyFormSchema = z.object({
  unitId: z.string().uuid('A valid unit is required'),
  tenantName: z.string().min(1, 'Tenant name is required').max(120),
  tenantContact: z.string().max(200).nullable().optional(),
  startDate: isoDate,
  // `|| null` in the action maps "" to null before this runs; when present it must be
  // a well-formed date. `.nullable().optional()` lets an omitted/null end_date through.
  endDate: isoDate.nullable().optional(),
  // Captured now for the future rent roll; unused by the timeline. `|| null` maps ""/"0"
  // to null in the action, and `.positive()` rejects a non-positive rent that reaches here.
  rentAmount: z.coerce.number().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type TenancyFormValues = z.infer<typeof tenancyFormSchema>
