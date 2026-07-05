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
