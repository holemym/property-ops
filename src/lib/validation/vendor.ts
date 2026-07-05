import { z } from 'zod'

export const vendorCategoryEnum = z.enum([
  'PLUMBING',
  'HEATING',
  'ELECTRICAL',
  'CLEANING',
  'LOCKSMITH',
  'APPLIANCE_REPAIR',
  'HANDYMAN',
  'PEST_CONTROL',
  'OTHER',
])

export const vendorFormSchema = z.object({
  companyName: z.string().min(2, 'Company name is required').max(120),
  contactName: z.string().nullable().optional(),
  // The action maps blank inputs "" -> null before parsing (the template idiom), so the
  // schema never sees "" for email — a plain .email().nullable().optional() is enough:
  // a real address validates, and an omitted/blank field arrives as null and passes.
  email: z.string().email('Invalid email').nullable().optional(),
  phone: z.string().nullable().optional(),
  serviceCategory: vendorCategoryEnum,
  notes: z.string().nullable().optional(),
})

export type VendorFormValues = z.infer<typeof vendorFormSchema>
