// Shared EUR money formatter for the property hub. Amounts are rounded to whole euros
// (the hub shows summary figures, not cents). Self-contained so the hub does not depend
// on anything the concurrent unit-hub work may add.
export function formatEur(amount: number): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(Math.round(amount))
}
