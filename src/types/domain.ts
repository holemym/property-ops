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
