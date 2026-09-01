import { z } from 'zod'

// v1 accepts calendar dates as ISO `YYYY-MM-DD` (the HTML <input type="date"> format
// and the Postgres `date` column format). We validate the shape with a regex rather
// than z.coerce.date() so the value stays a plain date string end-to-end (no timezone
// shifting from a Date round-trip). start_date is required; end_date is optional/null
// (null = open-ended / month-to-month).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export const tenancyFormSchema = z
  .object({
    unitId: z.string().uuid('A valid unit is required'),
    // Optional directory-person link (P1-3). "" -> undefined in the action (the
    // template idiom), so an unlinked tenancy simply omits this key. When present,
    // createTenancy re-resolves tenant_name from this id server-side rather than
    // trusting tenantName below — see the CRITICAL comment there.
    tenantId: z.string().uuid('Invalid person selected').nullable().optional(),
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
  // Cross-field: an inverted span (end before start) is never meaningful. `>=` (not `>`)
  // keeps a single-day tenancy (end == start) valid. ISO `YYYY-MM-DD` strings compare
  // chronologically as plain strings, so no Date round-trip is needed (same convention
  // as the timeline builder).
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must be on or after the start date.',
    path: ['endDate'],
  })

export type TenancyFormValues = z.infer<typeof tenancyFormSchema>
