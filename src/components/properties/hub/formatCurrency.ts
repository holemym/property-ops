// The property hub's money display — whole-euro EUR via THE shared formatter.
// (This file once carried its own Intl instance "so the hub does not depend on
// anything the concurrent unit-hub work may add" — that work shipped long ago.)
import { formatMoney } from '@/lib/format-money'

export function formatEur(amount: number): string {
  return formatMoney(amount)
}
