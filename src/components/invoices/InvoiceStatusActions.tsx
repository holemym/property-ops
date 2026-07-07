import { SubmitButton } from '@/components/tickets/SubmitButton'
import type { Invoice, InvoiceStatus } from '@/types/domain'

// Contextual status buttons for an invoice (server component — plain <form> per button, no
// client JS). MVP has NO strict state machine: any finance:write user may set any status.
// We just render the sensible next moves for the CURRENT status. Each button posts the
// setInvoiceStatusAction (bound with the invoice id at the call site) with a hidden `status`.
//
// Buttons offered per current status:
//   DRAFT   → Send, Void
//   SENT    → Mark paid, Mark partial, Mark overdue, Void
//   PARTIAL → Mark paid, Mark overdue, Void
//   OVERDUE → Mark paid, Mark partial, Void
//   PAID    → Reopen (→ SENT)
//   VOID    → Reopen (→ DRAFT)

type StatusButton = { status: InvoiceStatus; label: string; variant?: 'outline' | 'default' | 'ghost' }

const NEXT_STATUSES: Record<InvoiceStatus, StatusButton[]> = {
  DRAFT: [
    { status: 'SENT', label: 'Send' },
    { status: 'VOID', label: 'Void', variant: 'ghost' },
  ],
  SENT: [
    { status: 'PAID', label: 'Mark paid' },
    { status: 'PARTIAL', label: 'Mark partial', variant: 'outline' },
    { status: 'OVERDUE', label: 'Mark overdue', variant: 'outline' },
    { status: 'VOID', label: 'Void', variant: 'ghost' },
  ],
  PARTIAL: [
    { status: 'PAID', label: 'Mark paid' },
    { status: 'OVERDUE', label: 'Mark overdue', variant: 'outline' },
    { status: 'VOID', label: 'Void', variant: 'ghost' },
  ],
  OVERDUE: [
    { status: 'PAID', label: 'Mark paid' },
    { status: 'PARTIAL', label: 'Mark partial', variant: 'outline' },
    { status: 'VOID', label: 'Void', variant: 'ghost' },
  ],
  PAID: [{ status: 'SENT', label: 'Reopen', variant: 'outline' }],
  VOID: [{ status: 'DRAFT', label: 'Reopen', variant: 'outline' }],
}

export function InvoiceStatusActions({
  invoice,
  action,
}: {
  invoice: Invoice
  action: (formData: FormData) => void | Promise<void>
}) {
  const buttons = NEXT_STATUSES[invoice.status] ?? []

  if (buttons.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This invoice is {invoice.status.toLowerCase()}.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map((b) => (
        <form key={b.status} action={action}>
          <input type="hidden" name="status" value={b.status} />
          <SubmitButton variant={b.variant ?? 'outline'} size="sm" pendingLabel="Saving">
            {b.label}
          </SubmitButton>
        </form>
      ))}
    </div>
  )
}
