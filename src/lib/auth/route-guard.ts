import { createClient } from '@/lib/supabase/server'
import { needsMfaChallenge } from '@/lib/auth/mfa'

// Route Handlers (the CSV exports) authenticate via getCurrentUser() + can() and so
// bypass requireUser()'s enforceMfaChallenge() — which meant an AAL1 session whose MFA
// challenge was still pending (attacker holding just the password of an enrolled user)
// could download full finance/invoice CSVs. RLS doesn't consider AAL, so real rows came
// back. This is the step-up gate for that surface: same predicate as session.ts's
// enforceMfaChallenge, but returning a boolean (a Response-world caller can't redirect).
//
// Fails OPEN on a read error, deliberately matching enforceMfaChallenge — the check is
// a local JWT-claim read and a transient failure must not lock real users out of
// exports while every page still works.
export async function routeMfaSatisfied(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data) return true
  return !needsMfaChallenge(data.currentLevel, data.nextLevel)
}
