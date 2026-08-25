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
// tenant_id (migration 0025) OPTIONALLY links to a directory `Tenant` record (see
// src/lib/data/tenants.ts) — null for every pre-P1 tenancy and any tenancy left
// unlinked going forward; tenant_name stays the display fallback either way. P1-3
// wires up the write path (createTenancy resolves tenant_id server-side); P1-1
// only adds the column, so it is always null until then.
export type Tenancy = {
  id: string
  workspace_id: string
  unit_id: string
  tenant_id: string | null
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
  // First day of the billed month (migration 0027, Track P3) — set only on
  // invoices produced by "Generate rent"; null for owner statements, vendor
  // bills, and ad-hoc tenant invoices. Paired with tenancy_id in the partial
  // unique index invoices_tenancy_period_unique (VOID excluded) that is the
  // actual dedupe guarantee for recurring rent — see src/lib/invoices/recurring.ts.
  billing_period: string | null
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

// In-app notification event type (migration 0026). Every Postgres-enum-backed union
// in this schema lives here regardless of which migration introduced it (unlike the
// bigger entity ROW types, which split local-vs-domain.ts by migration number — see
// roadmap v2 §2); the `Notification` row type itself stays local to
// src/lib/data/notifications.ts, following the src/lib/data/tenants.ts (0025)
// precedent. Written by src/lib/notifications/notify-inapp.ts.
export type NotificationType = 'TICKET_ASSIGNED' | 'TICKET_STATUS_CHANGED' | 'TICKET_COMMENT'

// Auth audit event type (migration 0028, Track S2.2). Written by
// src/lib/audit/log-auth-event.ts (`logAuthEvent`) from the auth server
// actions (login/signup/sign-out/password-change, settings/users
// invite/deactivate) and the MFA challenge flow. Row type (`AuthEvent`) stays
// local to src/lib/data/auth-events.ts, following the tenants (0025) /
// notifications (0026) precedent for recently-added entities.
export type AuthEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'SIGNUP_SUCCESS'
  | 'SIGN_OUT'
  | 'PASSWORD_CHANGE'
  | 'INVITE_SENT'
  | 'DEACTIVATION'
  | 'MFA_CHALLENGE_SUCCESS'
  | 'MFA_CHALLENGE_FAILURE'

// Announcement status (migration 0030, Phase 1B tenant portal read-surfaces).
// DRAFT = manager-composed, not yet visible to any tenant/guest; PUBLISHED = live
// on the tenant portal (announcements_select_published_for_tenant RLS pins this
// exact value — a tenant never sees a DRAFT regardless of workspace/property
// match). The `Announcement` row type itself stays local to
// src/lib/data/announcements.ts, following the tenants (0025) / notifications
// (0026) / auth-events (0028) precedent for recently-added entities.
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED'

// Betriebskosten U-A (migration 0031, product-deepening plan §4). MRG section 21
// exhaustively lists which operating costs may be passed through to tenants —
// this enum encodes that catalog. DELIBERATELY NO 'OTHER' MEMBER (unlike every
// other category enum in this file): an escape hatch would defeat the entire
// compliance point, since "anything I can't classify" is exactly how a
// non-passable cost (a repair, a bank fee, a lawyer's invoice) would sneak onto
// a statement. HEATING/HOT_WATER are also deliberately absent — those are
// HeizKG, not MRG section 21, and need a measured-consumption basis (U-B) that
// this slice does not implement; admitting them here with only an area basis
// available would let an operator produce a facially-valid but unlawful heat
// split. See src/lib/betriebskosten/catalog.ts for the reviewable per-category
// legal-basis/consent/cap metadata (kept in code, not the DB, same split as
// every other enum's semantics in this schema).
export type OperatingCostCategory =
  | 'WATER_SEWER'
  | 'DRAIN_CLEANING'
  | 'WASTE_DISPOSAL'
  | 'PEST_CONTROL'
  | 'CHIMNEY_SWEEP'
  | 'COMMON_ELECTRICITY'
  | 'INSURANCE_FIRE'
  | 'INSURANCE_LIABILITY'
  | 'INSURANCE_WATER_DAMAGE'
  | 'INSURANCE_OTHER'
  | 'PUBLIC_CHARGES'
  | 'MANAGEMENT_FEE'
  | 'CARETAKER'
  | 'CLEANING'
  | 'SNOW_REMOVAL'
  | 'GARDEN_MAINTENANCE'
  | 'ELEVATOR'
  | 'COMMON_FACILITY_OTHER'

// The MRG section 17 default distribution key (USABLE_AREA = Nutzflaeche-
// proportional) plus PER_UNIT (equal split — legitimate for some section 24
// Gemeinschaftsanlagen by agreement). CONSUMPTION / HEATED_AREA (HeizKG) are a
// U-B seam, added later via `alter type ... add value` — never in the same
// migration/transaction as code that references them (Postgres forbids using a
// freshly-added enum value in the transaction that added it).
export type AllocationBasis = 'USABLE_AREA' | 'PER_UNIT'

// A settlement period's lifecycle (migration 0031). DRAFT = being assembled;
// ALLOCATED = an allocation run has been persisted (preview, still editable);
// FINALIZED = locked — the settlement_child_lock_guard trigger rejects any
// insert/update/delete on the period's cost positions/rules/allocations from
// this point on, for every role; VOID = superseded, also locked (never deleted,
// same convention as invoices — 0019).
export type SettlementStatus = 'DRAFT' | 'ALLOCATED' | 'FINALIZED' | 'VOID'
