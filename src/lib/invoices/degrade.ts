// Detects the specific "migration 0027 hasn't been applied yet" failure mode for
// "Generate rent" (Track P3, P3-2): a PostgREST/Postgres error caused by
// `invoices.billing_period` not existing in this environment's database yet. This is
// the SAME ship-before-migration hazard P1-2 (/people before migration 0025) and P2-2
// (the TopNav bell's unread count before migration 0026) already hit — code lands as a
// commit before a human pastes the migration into the Supabase SQL editor, the app is
// LIVE the whole time, and a click in that gap must degrade to a friendly message,
// never a raw 500. See src/app/(app)/invoices/actions.ts's generateRentInvoicesAction,
// the only caller.
//
// Multi-signal, message-anchored with a code as confirmation — a relative of
// src/lib/auth/error-messages.ts's friendlyAuthError (code-first there, since every
// AuthError variant has a stable code; here the message is the anchor because PostgREST's
// exact behaviour for a query naming an undefined column isn't fully pinned down from this
// environment — there is no live pre-migration Supabase to exercise it against, and
// running production DDL is out of bounds for this task). Sometimes PostgREST passes
// through the raw Postgres error code for an undefined column (42703, undefined_column)
// once the query reaches the database; sometimes its own schema-cache validation layer
// (which can reject an unrecognised column before ever reaching Postgres) reports it as
// PGRST204. Both are accepted as confirmation once the message names the column.
const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204'])

export function isMissingBillingPeriodColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message =
    'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : ''

  // The message must name the column — this is what keeps the check specific to
  // billing_period rather than matching ANY missing-column error (e.g. some other
  // column dropped from the schema, or an unrelated 42703 elsewhere). A recognised code
  // OR a "does not exist"/"schema cache" phrase then confirms it's genuinely a
  // missing-column situation, not e.g. a check-constraint message that merely mentions
  // the column name in passing.
  if (!message.includes('billing_period')) return false
  return MISSING_COLUMN_CODES.has(code) || message.includes('does not exist') || message.includes('schema cache')
}
