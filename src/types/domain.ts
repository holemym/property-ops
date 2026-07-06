export type Role =
  | 'SUPER_ADMIN'
  | 'OWNER'
  | 'OPERATOR'
  | 'ACCOUNTANT'
  | 'TENANT'
  | 'GUEST'
  | 'VENDOR'

export type PropertyType = 'APARTMENT_BUILDING' | 'SINGLE_APARTMENT' | 'MIXED_USE' | 'OFFICE' | 'OTHER'
export type EntityStatus = 'ACTIVE' | 'ARCHIVED'

export type OccupancyType = 'LONG_TERM' | 'SHORT_TERM' | 'VACANT' | 'MIXED'
export type UnitStatus = 'OCCUPIED' | 'VACANT' | 'MAINTENANCE' | 'BLOCKED'

export type VendorCategory =
  | 'PLUMBING'
  | 'HEATING'
  | 'ELECTRICAL'
  | 'CLEANING'
  | 'LOCKSMITH'
  | 'APPLIANCE_REPAIR'
  | 'HANDYMAN'
  | 'PEST_CONTROL'
  | 'OTHER'

export type TicketCategory =
  | 'PLUMBING'
  | 'HEATING'
  | 'ELECTRICAL'
  | 'CLEANING'
  | 'APPLIANCE'
  | 'INTERNET'
  | 'KEYS'
  | 'DAMAGE'
  | 'NOISE'
  | 'BILLING'
  | 'OTHER'

export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'

export type TicketStatus =
  | 'NEW'
  | 'TRIAGE'
  | 'WAITING_FOR_INFO'
  | 'ASSIGNED'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED'
  | 'CANCELLED'

export type ActorType = 'USER' | 'SYSTEM' | 'AI' | 'AUTOMATION'

export type TicketEventType =
  | 'TICKET_CREATED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'OPERATOR_ASSIGNED'
  | 'VENDOR_ASSIGNED'
  | 'COMMENT_ADDED'
  | 'ATTACHMENT_UPLOADED'
  | 'AI_CLASSIFICATION_GENERATED'
  | 'EXPENSE_LINKED'
  | 'INVOICE_UPLOADED'
  | 'TICKET_CLOSED'

export type CommentVisibility = 'PUBLIC' | 'INTERNAL'

export type CommentType = 'MESSAGE' | 'SYSTEM_NOTE' | 'AI_NOTE'

export type AttachmentType = 'PHOTO' | 'INVOICE' | 'RECEIPT' | 'CONTRACT' | 'REPORT' | 'OTHER'

// A time-ranged occupancy record for a unit (migration 0016). Drives the occupancy
// timeline; unlike UnitStatus (a point-in-time ops flag), a tenancy expresses an
// occupied span. end_date null = open-ended / month-to-month. tenant_name /
// tenant_contact are PII (SELECT is role-gated to managers + accountant via RLS).
// rent_amount is captured for the future rent roll and is unused by the timeline.
export type Tenancy = {
  id: string
  workspace_id: string
  unit_id: string
  tenant_name: string
  tenant_contact: string | null
  start_date: string
  end_date: string | null
  rent_amount: number | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}
