import { z } from 'zod'

// 11 categories / 4 priorities / 9 statuses — mirror src/types/domain.ts and the
// 0011/0012 DB enums exactly. Kept as local zod enums (rather than derived from the
// TS union) to match the property/unit validation style in this codebase.
export const ticketCategoryEnum = z.enum([
  'PLUMBING', 'HEATING', 'ELECTRICAL', 'CLEANING', 'APPLIANCE',
  'INTERNET', 'KEYS', 'DAMAGE', 'NOISE', 'BILLING', 'OTHER',
])
export const ticketPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
export const ticketStatusEnum = z.enum([
  'NEW', 'TRIAGE', 'WAITING_FOR_INFO', 'ASSIGNED', 'SCHEDULED',
  'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED',
])
export const commentVisibilityEnum = z.enum(['PUBLIC', 'INTERNAL'])

// Create payload. propertyId/unitId come from selects, so they are validated as uuids
// HERE (they are user-supplied ids, not free text). createdBy is auth.uid(), set
// server-side in the P3.6 action — NOT part of this client-facing schema.
export const ticketCreateSchema = z.object({
  propertyId: z.string().uuid(),
  unitId: z.string().uuid().nullable().optional(),
  title: z.string().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().min(1, 'Description is required'),
  category: ticketCategoryEnum,
  priority: ticketPriorityEnum,
})

export type TicketCreateValues = z.infer<typeof ticketCreateSchema>

// Comment payload. RLS enforces WHO may set INTERNAL (tenants are pinned to PUBLIC by
// comments_insert_own_public); this schema only validates shape.
export const ticketCommentSchema = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000),
  visibility: commentVisibilityEnum,
})

export type TicketCommentValues = z.infer<typeof ticketCommentSchema>

// Status-transition action payload. Legality of the transition itself is enforced by
// assertTransition() in updateTicketStatus, not here — this only validates the enum.
export const ticketStatusSchema = z.object({
  status: ticketStatusEnum,
})

export type TicketStatusValues = z.infer<typeof ticketStatusSchema>
