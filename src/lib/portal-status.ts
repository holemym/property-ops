import type { InvoiceStatus, TicketStatus } from '@/types/domain'

// Tenant-facing translation of the internal ticket lifecycle. Tenants should never see
// operator jargon ("TRIAGE", "WAITING_FOR_INFO", "ASSIGNED") — they see a plain,
// reassuring stage. Pure + DB-free so it's unit-testable and shareable across the portal
// list, detail header, and the progress stepper.

// The four stages a tenant follows, in order. Off-track states (waiting / cancelled) are
// represented separately by `kind`, not as a fifth stage.
export const TENANT_STAGES = ['Received', 'Scheduled', 'In progress', 'Resolved'] as const
export type TenantStage = (typeof TENANT_STAGES)[number]

export type TenantProgress =
  // A normal in-flight request sitting at `stageIndex` (0..3).
  | { kind: 'active'; stageIndex: number }
  // Finished — all four stages complete.
  | { kind: 'done'; stageIndex: number }
  // Blocked on the tenant: the manager asked for more information.
  | { kind: 'waiting'; stageIndex: number }
  // Cancelled — the stepper is replaced by a quiet cancelled state.
  | { kind: 'cancelled' }

/** Map an internal ticket status to the tenant's progress position. */
export function tenantProgress(status: TicketStatus): TenantProgress {
  switch (status) {
    case 'CANCELLED':
      return { kind: 'cancelled' }
    case 'RESOLVED':
    case 'CLOSED':
      return { kind: 'done', stageIndex: 3 }
    case 'IN_PROGRESS':
      return { kind: 'active', stageIndex: 2 }
    case 'ASSIGNED':
    case 'SCHEDULED':
      return { kind: 'active', stageIndex: 1 }
    case 'WAITING_FOR_INFO':
      return { kind: 'waiting', stageIndex: 0 }
    case 'NEW':
    case 'TRIAGE':
    default:
      return { kind: 'active', stageIndex: 0 }
  }
}

const TENANT_LABELS: Record<TicketStatus, string> = {
  NEW: 'Received',
  TRIAGE: 'Received',
  WAITING_FOR_INFO: 'Waiting for your reply',
  ASSIGNED: 'Being arranged',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Completed',
  CANCELLED: 'Cancelled',
}

/** A short, friendly status label for a tenant (no operator jargon). */
export function tenantStatusLabel(status: TicketStatus): string {
  return TENANT_LABELS[status]
}

// Tenant-facing translation of invoice status (My Charges, Phase 1B). A tenant's own
// RLS-scoped read (listTenantCharges, src/lib/data/invoices.ts) never returns DRAFT, so
// that entry only exists for type exhaustiveness. The one deliberate label swap vs. the
// operator's shared statusBadge('invoice_status', ...) copy (src/lib/status.ts) is
// VOID -> 'Cancelled': a tenant reading "Void" would not recognise the term, whereas
// "Cancelled" plainly explains why a bill they may have already seen is no longer due
// (see migration 0030's own design notes on this). The TONE (color) still comes from
// the shared statusBadge() helper — this function only overrides the copy, so the
// color system stays one convention.
const TENANT_INVOICE_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Due',
  PARTIAL: 'Partially paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Cancelled',
}

/** A tenant-friendly label for an invoice's DISPLAY status (pass 'OVERDUE' when
 * isInvoiceOverdue(...) is true, exactly like the operator InvoiceTable derives it). */
export function tenantInvoiceStatusLabel(status: InvoiceStatus): string {
  return TENANT_INVOICE_LABELS[status]
}
