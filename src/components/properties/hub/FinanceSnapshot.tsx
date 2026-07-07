import { formatEur } from './formatCurrency'

// Small money summary for the property hub: total income, total expense, and net
// (income − expense) scoped to this property (records booked directly on the property
// or on any of its units). Net is tone-accented green/red. Self-contained.
export function FinanceSnapshot({
  income,
  expense,
}: {
  income: number
  expense: number
}) {
  const net = income - expense
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between">
        <dt className="text-muted-foreground">Income</dt>
        <dd className="font-medium tabular-nums text-foreground">{formatEur(income)}</dd>
      </div>
      <div className="flex items-center justify-between">
        <dt className="text-muted-foreground">Expense</dt>
        <dd className="font-medium tabular-nums text-foreground">{formatEur(expense)}</dd>
      </div>
      <div className="mt-1 flex items-center justify-between border-t pt-2">
        <dt className="font-medium text-foreground">Net</dt>
        <dd
          className={
            net < 0
              ? 'font-semibold tabular-nums text-red-700 dark:text-red-400'
              : 'font-semibold tabular-nums text-green-700 dark:text-green-400'
          }
        >
          {formatEur(net)}
        </dd>
      </div>
    </dl>
  )
}
