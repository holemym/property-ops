'use client'

import { useState, type FormEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isValidTotpCode } from '@/lib/auth/mfa'
import { logMfaChallengeOutcome } from '@/app/(auth)/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormError } from '@/components/common/FormError'

// The AAL2 step-up form (S2-1 spec §3): 6-digit code -> mfa.challenge + mfa.verify, both
// CLIENT-side — this must run against the CURRENT browser session so a successful
// verify elevates THIS session's cookies to AAL2 (a server action would only elevate an
// ephemeral request-scoped session, not the one the browser is holding). On success we
// hard-navigate with window.location.assign (not router.push): verify() rewrites the
// sb-* session cookies, and a soft client transition would render /dashboard against the
// stale pre-verify RSC payload/cookie snapshot.
export function MfaChallenge({ factorId }: { factorId: string }) {
  const supabase = createClient()

  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!isValidTotpCode(code)) return

    setPending(true)
    setError(null)

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    })
    if (challengeError || !challenge) {
      setPending(false)
      setError(challengeError?.message ?? 'Could not verify. Try again.')
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setPending(false)
      setError('Incorrect code. Check your authenticator app and try again.')
      // S2-2: best-effort audit write — logMfaChallengeOutcome never throws
      // (see (auth)/actions.ts), so awaiting it here only orders the write
      // before the error is shown; it can never turn a wrong code into a
      // worse error or block the retry.
      await logMfaChallengeOutcome(false)
      return
    }

    // S2-2: same best-effort write on the success path, awaited before the
    // hard navigation below so the request isn't aborted mid-flight by the
    // page unload.
    await logMfaChallengeOutcome(true)
    window.location.assign('/dashboard')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormError message={error} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-code">6-digit code</Label>
        <Input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          autoFocus
          required
        />
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending || !isValidTotpCode(code)}>
        {pending ? 'Verifying…' : 'Verify'}
      </Button>
    </form>
  )
}
