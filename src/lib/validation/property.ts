import { z } from 'zod'

export const propertyTypeEnum = z.enum(['APARTMENT_BUILDING', 'SINGLE_APARTMENT', 'MIXED_USE', 'OFFICE', 'OTHER'])

export const propertyFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(120),
  addressLine1: z.string().min(3, 'Address is required'),
  addressLine2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  postalCode: z.string().min(1, 'Postal code is required'),
  country: z.string().min(1, 'Country is required'),
  propertyType: propertyTypeEnum,
  notes: z.string().optional(),
})

export type PropertyFormValues = z.infer<typeof propertyFormSchema>
