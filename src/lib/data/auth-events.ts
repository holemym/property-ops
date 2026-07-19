import type { SupabaseClient } from '@supabase/supabase-js'
import type { AuthEventType } from '@/types/domain'

// Row type for `public.auth_events` (migration 0028) — kept LOCAL to this
// data file, following the tenants (0025) / notifications (0026) precedent
// for recently-added entities (roadmap v2 §2: "the trend is toward LOCAL").
// AuthEventType itself (the enum union) lives in src/types/domain.ts, like
// every Postgres-enum-backed union in this codebase.
export type AuthEvent = {
  id: string
  workspace_id: string | null
  actor_user_id: string | null
  event_type: AuthEventType
  email: string | null
  ip: string | null
  user_agent: string | null
  metadata_json: unknown | null
  created_at: string
}

const DEFAULT_LIMIT = 50

/**
 * Most-recent-first audit feed for /settings/security's admin-only section.
 *
 * DEFENSIVE, UNLIKE EVERY OTHER READ IN THIS DATA LAYER: this does NOT
 * `throw` on error — it swallows and returns []. Migrations 0022-0028 have
 * not been applied to production as of this writing (see roadmap v2 §2), so
 * `auth_events` does not exist there yet; a settings page must never 500
 * because an optional audit surface isn't live yet. RLS
 * (auth_events_select_admin, migration 0028) is still the real security
 * boundary for WHO can read a row that does exist — swallowing the error here
 * is purely an availability concern for a missing/erroring table, not a
 * security relaxation (a real RLS rejection for an unauthorized caller
 * degrades to the same empty list an honest "no rows yet" would, which is the
 * correct behavior either way — the page-level `can(role, 'users:invite')`
 * gate in src/app/(app)/settings/security/page.tsx decides whether to even
 * render this section, same belt-and-suspenders pattern used everywhere else
 * in this codebase).
 */
export async function listRecentAuthEvents(
  supabase: SupabaseClient,
  workspaceId: string,
  limit: number = DEFAULT_LIMIT
): Promise<AuthEvent[]> {
  try {
    const { data, error } = await supabase
      .from('auth_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) {
      console.error('[audit] listRecentAuthEvents failed (table may not exist yet):', error.message)
      return []
    }
    return (data ?? []) as unknown as AuthEvent[]
  } catch (e) {
    console.error('[audit] listRecentAuthEvents threw:', e)
    return []
  }
}

// ---------------------------------------------------------------------------
// Pure presentation helper — the label shown in the admin table's Event
// column. Extracted so it's unit-testable and the fallback (an unrecognized
// future event type still renders its raw enum value instead of a blank
// cell) is exercised without rendering the page.
// ---------------------------------------------------------------------------

const AUTH_EVENT_LABELS: Record<AuthEventType, string> = {
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILURE: 'Login failed',
  SIGNUP_SUCCESS: 'Account created',
  SIGN_OUT: 'Signed out',
  PASSWORD_CHANGE: 'Password changed',
  INVITE_SENT: 'Invite sent',
  DEACTIVATION: 'User deactivated',
  MFA_CHALLENGE_SUCCESS: 'Two-factor code verified',
  MFA_CHALLENGE_FAILURE: 'Two-factor code rejected',
}

export function authEventLabel(type: AuthEventType): string {
  return AUTH_EVENT_LABELS[type] ?? type
}
