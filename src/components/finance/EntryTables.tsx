import type { IncomeRecord, ExpenseRecord } from '@/types/domain'
import { Badge } from '@/components/ui/badge'
import { formatMoney, formatDate, humanizeCategory } from './shared'

// Read-only tables of recent income / expense entries. Category renders as a tone-tinted
// Badge pill (blue for income, amber for expense — saturated colour stays reserved for
// meaning, matching the app's badge tones). A resolved property/unit label sits under the
// category as context; a linked ticket shows as a subtle "· ticket" note on expenses.

export type EntryLabels = {
  // unit_id / property_id → a human label ('Alpha · 1A' or 'Alpha').
  labelFor: (record: { property_id: string | null; unit_id: string | null }) => string | null
}

export function IncomeTable({
  rows,
  labelFor,
}: {
  rows: IncomeRecord[]
} & EntryLabels) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Category</th>
            <th className="pb-2 font-medium">Where</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0 align-top">
              <td className="py-2 pr-2 whitespace-nowrap tabular-nums text-muted-foreground">
                {formatDate(r.period_start)}
              </td>
              <td className="py-2 pr-2">
                <Badge variant="blue" className="capitalize">
                  {humanizeCategory(r.category)}
                </Badge>
              </td>
              <td className="py-2 pr-2 text-muted-foreground">
                {labelFor(r) ?? <span className="text-muted-foreground">Portfolio</span>}
              </td>
              <td className="py-2 text-right tabular-nums font-medium text-foreground">
                {formatMoney(r.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ExpenseTable({
  rows,
  labelFor,
  ticketTitleFor,
}: {
  rows: ExpenseRecord[]
  ticketTitleFor: (ticketId: string) => string | null
} & EntryLabels) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Date</th>
            <th className="pb-2 font-medium">Category</th>
            <th className="pb-2 font-medium">Where</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const ticket = r.ticket_id ? ticketTitleFor(r.ticket_id) : null
            return (
              <tr key={r.id} className="border-b last:border-b-0 align-top">
                <td className="py-2 pr-2 whitespace-nowrap tabular-nums text-muted-foreground">
                  {formatDate(r.incurred_on)}
                </td>
                <td className="py-2 pr-2">
                  <Badge variant="amber" className="capitalize">
                    {humanizeCategory(r.category)}
                  </Badge>
                </td>
                <td className="py-2 pr-2 text-muted-foreground">
                  <span>{labelFor(r) ?? <span className="text-muted-foreground">Portfolio</span>}</span>
                  {ticket && (
                    <span className="block truncate text-xs text-muted-foreground">
                      Ticket · {ticket}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right tabular-nums font-medium text-foreground">
                  {formatMoney(r.amount)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
