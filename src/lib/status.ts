import type {
  EntityStatus,
  InvoiceStatus,
  TicketPriority,
  TicketStatus,
  UnitStatus,
} from '@/types/domain'

// Single source of truth for status presentation. Saturated color lives ONLY here
// (via `tone`); the rest of the app is near-monochrome graphite. `statusBadge()`
// maps a domain value to sentence-case human `label` + a semantic `tone`, which the
// <StatusBadge> component turns into a subtle, dark-mode-safe badge variant.
//
// Tone map is fixed by the design spec
// (docs/superpowers/specs/2026-07-06-property-ops-ux-polish-design.md):
//   status:   NEW/neutral, TRIAGE/amber, WAITING_FOR_INFO/amber, ASSIGNED/blue,
//             SCHEDULED/blue, IN_PROGRESS/blue, RESOLVED/green, CLOSED/neutral,
//             CANCELLED/muted
//   priority: LOW/neutral, NORMAL/neutral, HIGH/amber, URGENT/red
//   unit:     OCCUPIED/blue, VACANT/amber, MAINTENANCE/amber, BLOCKED/red
//   entity:   ACTIVE/green, ARCHIVED/neutral
//   vendor is_active: true → active/green, false → inactive/muted

export type StatusTone = 'neutral' | 'muted' | 'blue' | 'amber' | 'green' | 'red'

export interface StatusBadgeSpec {
  label: string
  tone: StatusTone
}

// The `kind`/`value` pairs statusBadge() accepts. Keeping this as a discriminated
// union means a mismatched value (e.g. an unknown ticket status) is a compile error.
export type StatusBadgeInput =
  | { kind: 'ticket_status'; value: TicketStatus }
  | { kind: 'ticket_priority'; value: TicketPriority }
  | { kind: 'unit_status'; value: UnitStatus }
  | { kind: 'entity_status'; value: EntityStatus }
  | { kind: 'invoice_status'; value: InvoiceStatus }
  | { kind: 'vendor_is_active'; value: boolean }

const TICKET_STATUS: Record<TicketStatus, StatusBadgeSpec> = {
  NEW: { label: 'New', tone: 'neutral' },
  TRIAGE: { label: 'Triage', tone: 'amber' },
  WAITING_FOR_INFO: { label: 'Waiting for info', tone: 'amber' },
  ASSIGNED: { label: 'Assigned', tone: 'blue' },
  SCHEDULED: { label: 'Scheduled', tone: 'blue' },
  IN_PROGRESS: { label: 'In progress', tone: 'blue' },
  RESOLVED: { label: 'Resolved', tone: 'green' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'muted' },
}

const TICKET_PRIORITY: Record<TicketPriority, StatusBadgeSpec> = {
  LOW: { label: 'Low', tone: 'neutral' },
  NORMAL: { label: 'Normal', tone: 'neutral' },
  HIGH: { label: 'High', tone: 'amber' },
  URGENT: { label: 'Urgent', tone: 'red' },
}

const UNIT_STATUS: Record<UnitStatus, StatusBadgeSpec> = {
  OCCUPIED: { label: 'Occupied', tone: 'blue' },
  VACANT: { label: 'Vacant', tone: 'amber' },
  MAINTENANCE: { label: 'Maintenance', tone: 'amber' },
  BLOCKED: { label: 'Blocked', tone: 'red' },
}

const ENTITY_STATUS: Record<EntityStatus, StatusBadgeSpec> = {
  ACTIVE: { label: 'Active', tone: 'green' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
}

const INVOICE_STATUS: Record<InvoiceStatus, StatusBadgeSpec> = {
  DRAFT: { label: 'Draft', tone: 'muted' },
  SENT: { label: 'Sent', tone: 'blue' },
  PARTIAL: { label: 'Partially paid', tone: 'amber' },
  PAID: { label: 'Paid', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  VOID: { label: 'Void', tone: 'neutral' },
}

const VENDOR_IS_ACTIVE: Record<'true' | 'false', StatusBadgeSpec> = {
  true: { label: 'Active', tone: 'green' },
  false: { label: 'Inactive', tone: 'muted' },
}

/**
 * Map a domain status value to its `{ label, tone }` presentation.
 * The overloads keep call sites type-safe: `statusBadge('unit_status', u.status)`
 * only accepts a `UnitStatus`, and returns a fully-resolved spec.
 */
export function statusBadge(kind: 'ticket_status', value: TicketStatus): StatusBadgeSpec
export function statusBadge(kind: 'ticket_priority', value: TicketPriority): StatusBadgeSpec
export function statusBadge(kind: 'unit_status', value: UnitStatus): StatusBadgeSpec
export function statusBadge(kind: 'entity_status', value: EntityStatus): StatusBadgeSpec
export function statusBadge(kind: 'invoice_status', value: InvoiceStatus): StatusBadgeSpec
export function statusBadge(kind: 'vendor_is_active', value: boolean): StatusBadgeSpec
export function statusBadge(kind: StatusBadgeInput['kind'], value: string | boolean): StatusBadgeSpec {
  switch (kind) {
    case 'ticket_status':
      return TICKET_STATUS[value as TicketStatus]
    case 'ticket_priority':
      return TICKET_PRIORITY[value as TicketPriority]
    case 'unit_status':
      return UNIT_STATUS[value as UnitStatus]
    case 'entity_status':
      return ENTITY_STATUS[value as EntityStatus]
    case 'invoice_status':
      return INVOICE_STATUS[value as InvoiceStatus]
    case 'vendor_is_active':
      return VENDOR_IS_ACTIVE[value ? 'true' : 'false']
  }
}

// Ticket statuses that no longer need attention — resolved, formally closed, or
// cancelled. This is THE single source of truth for the ticket open/done split (H3):
// dashboard, occupancy, insights/analytics, the property hub, the unit hub, and the map
// all import `isTicketOpen` from here instead of hand-rolling their own terminal-status
// list. Before H3, the dashboard alone omitted RESOLVED from its local list, so a
// resolved-but-not-yet-closed ticket read as "open" there and "done" everywhere else.
export const TERMINAL_TICKET_STATUSES: TicketStatus[] = ['RESOLVED', 'CLOSED', 'CANCELLED']

/** True when a ticket status still needs attention (i.e. not resolved/closed/cancelled). */
export function isTicketOpen(status: TicketStatus): boolean {
  return !TERMINAL_TICKET_STATUSES.includes(status)
}
