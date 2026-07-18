import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { needsMfaChallenge } from '@/lib/auth/mfa'
import { AuthCard } from '@/components/auth/AuthCard'
import { MfaChallenge } from '@/components/auth/MfaChallenge'

// The AAL2 step-up page (S2-1b, spec §3). AUTH BOUNDARY: this page deliberately does
// NOT call requireUser() — requireUser() (session.ts) redirects any AAL1-session-with-
// a-verified-factor HERE, so if this page also called requireUser() it would loop
// forever. Reachability while AAL1-pending is structural, not a path exemption bolted
// onto the gate: this page authenticates itself directly off getClaims() +
// getAuthenticatorAssuranceLevel(), the same "local, reads the session, no network"
// calls requireUser() uses. proxy.ts needs no change either — it only gates on "is
// there a session at all" (see proxy.ts's PUBLIC_PATHS comment), never on AAL, so an
// authenticated-but-AAL1 request reaches this page same as any other authenticated
// route; it is intentionally NOT added to PUBLIC_PATHS (it requires a real session).
export default async function MfaChallengePage() {
  const supabase = await createClient()

  const { data: claimsData } = await supabase.auth.getClaims()
  if (!claimsData?.claims) redirect('/login')

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  // Nothing to challenge here: either already AAL2, or (a no-factor user landing on
  // this URL directly, e.g. a stale bookmark) nextLevel never reaches 'aal2' in the
  // first place — see needsMfaChallenge's invariant proof in lib/auth/mfa.ts. Either
  // way, send them on rather than rendering a dead-end challenge form.
  if (!aal || !needsMfaChallenge(aal.currentLevel, aal.nextLevel)) {
    redirect('/dashboard')
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const factorId = factorsData?.totp?.find((f) => f.status === 'verified')?.id
  if (!factorId) redirect('/dashboard')

  return (
    <AuthCard
      title="Two-factor authentication"
      description="Enter the 6-digit code from your authenticator app."
    >
      <MfaChallenge factorId={factorId} />
    </AuthCard>
  )
}
