// THE money formatters. EUR, en-IE — the same locale every other formatter in
// src/lib is pinned to, so server and client render identically and the output
// never depends on the runtime's locale. Before this existed, near-identical
// Intl.NumberFormat blocks were re-declared in ~15 files (one of them with
// locale `undefined` — the lone money string in the app that rendered in the
// server's runtime locale). Reuse these; never re-roll a money formatter
// per-surface.

const wholeEuro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const exactEuro = new Intl.NumberFormat('en-IE', {
  style: 'currency',
  currency: 'EUR',
})

/** Whole-euro display for rollups/overviews: `€1,234`. Rounds half-up. */
export function formatMoney(amount: number): string {
  return wholeEuro.format(Math.round(amount))
}

/** Cent-exact display for statements/invoices/ledgers: `€1,234.56`. */
export function formatMoneyExact(amount: number): string {
  return exactEuro.format(amount)
}

// Per-currency formatters, cached per code (invoices carry their own currency
// column; everything else in the app is EUR).
const byCurrency = new Map<string, Intl.NumberFormat>()

/** Cent-exact display in an arbitrary currency: `formatMoneyIn('CHF', 12.5)`. */
export function formatMoneyIn(currency: string | null | undefined, amount: number): string {
  const code = currency || 'EUR'
  let fmt = byCurrency.get(code)
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-IE', { style: 'currency', currency: code })
    byCurrency.set(code, fmt)
  }
  return fmt.format(amount)
}
