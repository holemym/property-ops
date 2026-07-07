import { z } from 'zod'

// Same ISO `YYYY-MM-DD` calendar-date shape as tenancy.ts: the HTML <input type="date">
// format and the Postgres `date` column format. Validated by regex (not z.coerce.date())
// so the value stays a plain date string end-to-end with no timezone round-trip.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

const incomeCategory = z.enum(['RENT', 'DEPOSIT', 'FEE', 'OTHER'])
const expenseCategory = z.enum([
  'MAINTENANCE',
  'UTILITIES',
  'TAX',
  'INSURANCE',
  'MANAGEMENT',
  'OTHER',
])

// amount is a positive number — a ledger entry of zero or negative is not meaningful in
// finance-light (corrections are separate entries, not sign flips). z.coerce.number()
// parses the FormData string; .positive() rejects <= 0. propertyId / unitId / ticketId
// are OPTIONAL attribution (see 0017): `|| null` in the action maps "" to null, and when
// present each must be a well-formed uuid (the composite-FK backstop lives in the DB).
export const incomeFormSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  category: incomeCategory,
  periodStart: isoDate,
  // `|| null` in the action maps an empty period_end to null (point-in-time booking).
  periodEnd: isoDate.nullable().optional(),
  propertyId: z.string().uuid('A valid property is required').nullable().optional(),
  unitId: z.string().uuid('A valid unit is required').nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const expenseFormSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  category: expenseCategory,
  incurredOn: isoDate,
  propertyId: z.string().uuid('A valid property is required').nullable().optional(),
  unitId: z.string().uuid('A valid unit is required').nullable().optional(),
  ticketId: z.string().uuid('A valid ticket is required').nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type IncomeFormValues = z.infer<typeof incomeFormSchema>
export type ExpenseFormValues = z.infer<typeof expenseFormSchema>
