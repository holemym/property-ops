import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { redirectWithError } from '@/lib/redirect-with-error'
import { assertPermission, type Permission } from '@/lib/auth/permissions'
import { needsMfaChallenge } from '@/lib/auth/mfa'
import type { Role } from '@/types/domain'

export type CurrentUser = {
  id: string
  email: string
  fullName: string
  role: Role
  workspaceId: string | null
  isActive: boolean
}

// Pure mapping from decoded JWT claims to the minimal identity shell getCurrentUser
// needs. Extracted so the claims -> {id, email} mapping (and the "no sub" guard) is
// unit-testable without mocking the Supabase client. `sub` is the Supabase Auth user
// id (same value `user.id` held before this swap); `email` keeps the same `?? ''`
// fallback semantics the old `user.email ?? ''` had.
export function claimsToUserShell(
  claims: { sub: string; email?: string } | null | undefined
): { id: string; email: string } | null {
  if (!claims?.sub) return null
  return { id: claims.sub, email: claims.email ?? '' }
}

// Wrapped in React cache() so the auth call + profile lookup runs ONCE per request even
// though the (app) layout and every page call the require* chain — collapsing the
// repeated round-trips that made each navigation do redundant auth work.
//
// PERF-1a: uses auth.getClaims() instead of auth.getUser() here. getClaims() verifies
// the access token's signature locally against the project's cached JWKS (zero network
// once asymmetric signing keys are enabled — see PERF-1b), instead of round-tripping to
// the Supabase Auth server on every navigation. The middleware's own getUser() call
// (src/lib/supabase/middleware.ts) is untouched: it stays the network hop responsible
// for token refresh + cookie write-back and per-request revocation freshness. On
// projects still using legacy symmetric JWT secrets, getClaims() automatically falls
// back to a server-side verification call — same correctness, perf win just deferred.
export const getCurrentUser = cache(async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient()
  const { data: claimsData, error } = await supabase.auth.getClaims()
  const shell = claimsToUserShell(claimsData?.claims)

  if (error || !shell) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, workspace_id, is_active')
    .eq('id', shell.id)
    .single()

  // Note: any Supabase error here (missing profile, network issue, etc.) is treated
  // the same — falls through to redirect-to-login. Acceptable for MVP; revisit if this
  // causes confusing "logged in but bounced to /login" reports once live.
  if (!profile) return null

  return {
    id: shell.id,
    email: shell.email,
    fullName: profile.full_name,
    role: profile.role as Role,
    workspaceId: profile.workspace_id,
    isActive: profile.is_active,
  }
})

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  // Deactivated users keep a valid JWT until it expires, so getCurrentUser() still
  // resolves them. Bounce them here — this is the single app-layer chokepoint that
  // every gate flows through (requireWorkspace, requirePermission, and the (app)
  // layout all call requireUser), so enforcing is_active once here covers every
  // authenticated page. /login is a PUBLIC_PATH (see proxy.ts), so the redirect
  // does not loop, and the login page renders the ?error message.
  // NOTE: this is app-layer defense-in-depth; it does not revoke the Supabase Auth
  // session itself (that would need auth.admin ban_duration — tracked in
  // setUserActive). RLS + this check together are sufficient for now.
  if (!user.isActive) {
    redirectWithError('/login', 'Your account has been deactivated.')
  }
  await enforceMfaChallenge()
  return user
}

// S2-1b: the AAL enforcement gate. requireUser() is the single app-layer chokepoint
// every authenticated page/action flows through (requireWorkspace, requirePermission,
// the (app) layout, set-password, workspace/new — all call it), so putting the check
// here makes it universal without touching each call site.
//
// THE INVARIANT (see needsMfaChallenge's doc comment in lib/auth/mfa.ts for the proof):
// a user with no verified MFA factor gets `nextLevel === currentLevel` from Supabase,
// so `needsMfaChallenge()` is false for them and this function is a no-op — they are
// NEVER redirected here. Only an AAL1 session with a verified factor gets bounced to
// /auth/mfa to finish the TOTP challenge.
//
// Allowlist (spec §3): "/auth/mfa itself + signOut must stay reachable" while
// AAL1-pending. Both achieve that structurally, not via a path exemption in this
// function: signOut() ((auth)/actions.ts) never calls requireUser() at all, and the
// /auth/mfa page ((auth)/auth/mfa/page.tsx) deliberately does NOT call requireUser()
// either — if it did, this same redirect would fire on that page's own load and loop
// forever. It authenticates itself directly via getClaims() +
// getAuthenticatorAssuranceLevel() instead. proxy.ts is unaffected either way: it only
// gates on "is there a session at all" (updateSession's getUser()), never on AAL, so an
// AAL1-pending user reaching /auth/mfa never gets intercepted there.
//
// On an unexpected error reading the assurance level, this fails OPEN (no redirect) —
// consistent with the invariant above: never lock a user out due to a transient read
// failure on a check that's supposed to be a pure local JWT-claim read.
async function enforceMfaChallenge(): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return
  if (needsMfaChallenge(data.currentLevel, data.nextLevel)) {
    redirect('/auth/mfa')
  }
}

export async function requireWorkspace(): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireUser()
  if (!user.workspaceId) redirect('/workspace/new')
  return user as CurrentUser & { workspaceId: string }
}

// Unlike requireUser/requireWorkspace (which redirect), a permission failure here
// throws a plain Error, surfaced via Next.js's default error boundary. Revisit if
// Server Actions need friendlier "you don't have permission" UX later.
export async function requirePermission(permission: Permission): Promise<CurrentUser & { workspaceId: string }> {
  const user = await requireWorkspace()
  assertPermission(user.role, permission)
  return user
}
