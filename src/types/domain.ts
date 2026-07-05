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
