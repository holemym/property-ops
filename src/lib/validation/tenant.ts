import { z } from 'zod'

export const tenantFormSchema = z.object({
  fullName: z.string().min(1, 'Full name is required').max(120),
  // The action maps blank inputs "" -> null before parsing (the template idiom), so
  // the schema never sees "" for email — a plain .email().nullable().optional() is
  // enough: a real address validates, and an omitted/blank field arrives as null and
  // passes. Mirrors vendorFormSchema exactly.
  email: z.string().email('Invalid email').nullable().optional(),
  phone: z.string().nullable().optional(),
  // BCP-47-ish tag (e.g. 'de', 'en'); free text, no enum — v1 does not constrain it
  // (see spec §5 out-of-scope). P4 (German i18n) is the first consumer.
  language: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type TenantFormValues = z.infer<typeof tenantFormSchema>
