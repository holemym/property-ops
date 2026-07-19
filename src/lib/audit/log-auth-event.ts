import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthEventType } from '@/types/domain'
import { isDemoWorkspace } from '@/lib/demo'

// ---------------------------------------------------------------------------
// log-auth-event — the auth audit trail writer (S2-2). Mirrors the discipline
// of src/lib/notifications/notify-inapp.ts and src/lib/email/notify.ts:
// best-effort, NEVER throws, console.error on failure, so a broken/absent
// `auth_events` table (migration 0028 has not been applied to production as
// of this writing) can never fail the login/signup/sign-out/password-change/
// invite/deactivation/MFA-challenge action that triggered it.
//
// `auth_events` has a ZERO INSERT POLICY (migration 0028): only the
// service-role client (which bypasses RLS) can write it, so `serviceClient`
// below MUST be the service-role client (src/lib/supabase/service.ts) — same
// loud call-out as notify-inapp.ts's own header, for the same reason (an
// RLS-bound authenticated client's insert would not error, it would just
// silently write zero rows, a worse failure mode than a thrown error).
// ---------------------------------------------------------------------------

export type LogAuthEventInput = {
  eventType: AuthEventType
  // The workspace this event belongs to, when known. null/undefined when
  // unresolvable (e.g. a LOGIN_FAILURE against an email with no account).
  workspaceId?: string | null
  // The human who performed the action. Self for login/signup/sign-out/
  // password-change/MFA-challenge; the ADMIN for invite/deactivation (the
  // affected OTHER user goes in `email`/`metadata` instead — see migration
  // 0028's header for the actor-vs-subject convention).
  userId?: string | null
  // Human-readable subject of the event (see migration 0028 header).
  email?: string | null
  ip?: string | null
  userAgent?: string | null
  // Free-form context, e.g. { target_user_id } for DEACTIVATION.
  metadata?: Record<string, unknown> | null
}

/**
 * Write one auth audit event. Best-effort: NEVER throws — a DB failure
 * (missing table, RLS rejection, network blip) is caught and console.error'd,
 * exactly like createNotification/sendEmail. Callers should generally still
 * `await` this (matches the rest of the codebase's "await best-effort calls
 * for ordering" convention — rate limiting, notifications, and email are all
 * awaited in these exact same action flows already), but its own failure can
 * never propagate.
 *
 * Demo workspace guard (D4-style): skipped entirely for the shared public
 * demo workspace — see migration 0028's header for why this is safe to skip
 * rather than extend reset_demo_workspace() to wipe it.
 */
export async function logAuthEvent(
  serviceClient: SupabaseClient,
  input: LogAuthEventInput
): Promise<void> {
  if (isDemoWorkspace(input.workspaceId)) return

  try {
    const { error } = await serviceClient.from('auth_events').insert({
      workspace_id: input.workspaceId ?? null,
      actor_user_id: input.userId ?? null,
      event_type: input.eventType,
      email: normalizeEmail(input.email),
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
      metadata_json: input.metadata ?? null,
    })
    if (error) {
      console.error('[audit] failed to write auth event', input.eventType, error)
    }
  } catch (e) {
    console.error('[audit] logAuthEvent threw', input.eventType, e)
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — no I/O, unit-testable in isolation.
// ---------------------------------------------------------------------------

/** Trims + lowercases; blank/absent -> null (never stores an empty string). */
export function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase()
  return trimmed || null
}

/**
 * The raw `user-agent` header, trimmed; null when absent or blank. Mirrors
 * clientIp's shape (src/lib/rate-limit.ts) but lives here since it is only
 * ever used for audit-event context, not rate-limit keys.
 */
export function clientUserAgent(headers: Headers): string | null {
  const ua = headers.get('user-agent')
  const trimmed = ua?.trim()
  return trimmed || null
}

// ---------------------------------------------------------------------------
// resolveWorkspaceId / resolveAuthContext — best-effort identity resolution
// for call sites that don't already have a CurrentUser/requireUser() result
// in scope (signOut has none at all; signInWithPassword/signUpWithPassword
// only have the just-authenticated user's id, not their workspace; the MFA
// challenge outcome is reported from a lightweight server action that
// deliberately does NOT call requireUser() — see MfaChallengePage's own
// comment on why AAL-gated pages avoid that call). Both NEVER throw, for the
// same reason logAuthEvent doesn't: this is audit-context plumbing, not the
// auth action itself, and it must degrade to nulls, not an error.
// ---------------------------------------------------------------------------

/** profiles.workspace_id for a known user id; null on no-match or any error. */
export async function resolveWorkspaceId(
  supabase: SupabaseClient,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null
  try {
    const { data } = await supabase.from('profiles').select('workspace_id').eq('id', userId).single()
    return (data as { workspace_id: string | null } | null)?.workspace_id ?? null
  } catch (e) {
    console.error('[audit] resolveWorkspaceId threw', e)
    return null
  }
}

export type AuthContext = {
  userId: string | null
  email: string | null
  workspaceId: string | null
}

/**
 * Reads the CURRENT session's identity directly off getClaims() (a local JWT
 * read, same primitive requireUser()/MfaChallengePage use — no extra network
 * hop) plus a best-effort workspace lookup. Returns all-null on any failure
 * (no session, claims error, profile lookup error) rather than throwing.
 */
export async function resolveAuthContext(supabase: SupabaseClient): Promise<AuthContext> {
  try {
    const { data: claimsData } = await supabase.auth.getClaims()
    const claims = claimsData?.claims as { sub?: string; email?: string } | null | undefined
    const userId = claims?.sub ?? null
    const email = claims?.email ?? null
    const workspaceId = await resolveWorkspaceId(supabase, userId)
    return { userId, email, workspaceId }
  } catch (e) {
    console.error('[audit] resolveAuthContext threw', e)
    return { userId: null, email: null, workspaceId: null }
  }
}
