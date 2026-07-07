import { z } from 'zod'

// Mirrors the DB enums (migration 0019) and the finance.ts validation style. isoDate is
// the same YYYY-MM-DD calendar-date shape used across tenancy/finance forms.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')

export const invoicePartyTypeEnum = z.enum(['OWNER', 'TENANT', 'VENDOR', 'OTHER'])
export const invoiceDirectionEnum = z.enum(['OUTBOUND', 'INBOUND'])
export const invoiceStatusEnum = z.enum(['DRAFT', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'])

// A single billed line. quantity must be > 0 (matches the DB check). unit_amount is any
// number — a negative line is a legitimate discount/credit. amount is DERIVED (generated
// column), never submitted.
export const invoiceLineSchema = z.object({
  description: z.string().min(1, 'Each line needs a description').max(500),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unitAmount: z.coerce.number().finite('Enter a valid amount'),
})

// The five attribution ids are OPTIONAL (uuid when present); '' is mapped to undefined in
// the action, as in the finance forms. At least one line is required.
export const invoiceFormSchema = z.object({
  partyType: invoicePartyTypeEnum,
  partyName: z.string().min(1, 'Who is being invoiced?').max(200),
  direction: invoiceDirectionEnum.default('OUTBOUND'),
  currency: z.string().min(1).max(8).default('EUR'),
  taxRate: z.coerce.number().min(0, 'Tax rate cannot be negative').max(100, 'Tax rate cannot exceed 100%').default(0),
  issueDate: isoDate,
  dueDate: isoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  propertyId: z.string().uuid('A valid property is required').nullable().optional(),
  unitId: z.string().uuid('A valid unit is required').nullable().optional(),
  tenancyId: z.string().uuid('A valid tenancy is required').nullable().optional(),
  vendorId: z.string().uuid('A valid vendor is required').nullable().optional(),
  ticketId: z.string().uuid('A valid ticket is required').nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1, 'Add at least one line'),
})

// Status-transition payload (the DRAFT→SENT→PAID/VOID actions). Legality of a specific
// transition is enforced in the action; this only validates the enum.
export const invoiceStatusSchema = z.object({
  status: invoiceStatusEnum,
})

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>
export type InvoiceLineValues = z.infer<typeof invoiceLineSchema>
