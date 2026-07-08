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

// Finance-light categories (migration 0017). income_category / expense_category enums.
export type IncomeCategory = 'RENT' | 'DEPOSIT' | 'FEE' | 'OTHER'
export type ExpenseCategory =
  | 'MAINTENANCE'
  | 'UTILITIES'
  | 'TAX'
  | 'INSURANCE'
  | 'MANAGEMENT'
  | 'OTHER'

// A bookkeeping income entry (migration 0017). property_id / unit_id are OPTIONAL
// attribution (NULLABLE composite FKs — book at property, unit, or neither). period_start
// is the accounting period start (required); period_end null = point-in-time booking.
// currency is a label (no multi-currency conversion — YAGNI), defaults to 'EUR'. SELECT
// is role-gated to managers + accountant + operator via RLS; writes are can_manage_finance().
export type IncomeRecord = {
  id: string
  workspace_id: string
  property_id: string | null
  unit_id: string | null
  amount: number
  currency: string
  category: IncomeCategory
  period_start: string
  period_end: string | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

// A bookkeeping expense entry (migration 0017). Same shape as IncomeRecord with three
// deltas: a single incurred_on (the day incurred, required) replaces the period pair; an
// optional ticket_id links a manual expense back to the ticket it settles; category is
// ExpenseCategory (default 'MAINTENANCE').
export type ExpenseRecord = {
  id: string
  workspace_id: string
  property_id: string | null
  unit_id: string | null
  ticket_id: string | null
  amount: number
  currency: string
  category: ExpenseCategory
  incurred_on: string
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

// Document type (migration 0018). The kind of stored document, for display / filtering.
export type DocumentType =
  | 'LEASE'
  | 'CONTRACT'
  | 'PERMIT'
  | 'CERTIFICATE'
  | 'INSURANCE'
  | 'ID'
  | 'INVOICE'
  | 'OTHER'

// A document metadata row (migration 0018). A general documents repo: the BYTES live in
// the private 'documents' Storage bucket (path workspace_id/<uuid>-<file>); this row
// links the stored object to AT MOST ONE entity (property / unit / tenancy / vendor /
// ticket) — or none (a workspace-level document). Each entity link is a NULLABLE
// composite FK to (id, workspace_id), so a non-NULL link is pinned to this document's
// workspace (multi-tenant integrity; no polymorphic entity_id). title is the display
// name; storage_path is the unique object key; expires_at is an optional expiry (e.g.
// insurance/permit validity). SELECT is role-gated to managers + accountant via RLS;
// writes are is_workspace_manager() (accountant is read-only here).
export type Document = {
  id: string
  workspace_id: string
  property_id: string | null
  unit_id: string | null
  tenancy_id: string | null
  vendor_id: string | null
  ticket_id: string | null
  document_type: DocumentType
  title: string
  storage_path: string
  file_type: string
  file_size: number
  expires_at: string | null
  notes: string | null
  uploaded_by_user_id: string | null
  created_at: string
  updated_at: string
}

// Invoicing (migration 0019). ONE flexible model for owner statements, tenant rent
// invoices, and inbound vendor bills — the party is a discriminator, not a separate table.
export type InvoicePartyType = 'OWNER' | 'TENANT' | 'VENDOR' | 'OTHER'
// OUTBOUND = we bill the party (owner/tenant); INBOUND = the party bills us (vendor).
export type InvoiceDirection = 'OUTBOUND' | 'INBOUND'
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'VOID'

// An invoice header (migration 0019). party_type + party_name identify WHO is billed;
// the five nullable ids are OPTIONAL attribution (composite FKs, each pinned to this
// invoice's workspace). tax_rate is a single percentage (0..100); the money total is
// derived from the line items in the data layer, never stored. paid_at is stamped when
// status enters PAID. SELECT is role-gated to managers + accountant + operator via RLS;
// writes are can_manage_finance() (OWNER/ACCOUNTANT own the books).
export type Invoice = {
  id: string
  workspace_id: string
  invoice_number: string
  party_type: InvoicePartyType
  party_name: string
  direction: InvoiceDirection
  status: InvoiceStatus
  property_id: string | null
  unit_id: string | null
  tenancy_id: string | null
  vendor_id: string | null
  ticket_id: string | null
  currency: string
  tax_rate: number
  issue_date: string
  due_date: string | null
  paid_at: string | null
  // Optional delivery address (migration 0021) — where "Send" emails the invoice.
  recipient_email: string | null
  notes: string | null
  created_by_user_id: string
  created_at: string
  updated_at: string
}

// A billed line on an invoice (migration 0019). amount is a GENERATED column (quantity ×
// unit_amount) — never set directly. Lines cascade-delete with their invoice.
export type InvoiceLineItem = {
  id: string
  workspace_id: string
  invoice_id: string
  description: string
  quantity: number
  unit_amount: number
  amount: number
  sort_order: number
  created_at: string
}
