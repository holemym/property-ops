'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { isValidTotpCode } from '@/lib/auth/mfa'
import { formatDate } from '@/lib/format-date'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FormError } from '@/components/common/FormError'
import { ConfirmSubmit } from '@/components/common/ConfirmSubmit'

export type MfaFactorSummary = {
  id: string
  createdAt: string
}

// In-progress enrollment: set once `mfa.enroll()` returns, cleared on verify-success or
// cancel. Holds exactly what the QR/manual-entry step needs.
type PendingEnrollment = {
  factorId: string
  qrCode: string
  secret: string
}

// The whole "Two-factor authentication" card body. All `supabase.auth.mfa.*` calls are
// client-side (per spec) — enroll/verify must run against the CURRENT browser session so
// a successful verify immediately elevates it to AAL2, and unenroll likewise acts on the
// signed-in user's own factors. The server page (page.tsx) only supplies the initial
// `factors` list (server-side `mfa.listFactors()` read, cheap and avoids a client fetch
// waterfall on first paint); every mutation below calls `router.refresh()` afterwards so
// that server-rendered list catches up.
export function MfaEnroll({ factors }: { factors: MfaFactorSummary[] }) {
  const router = useRouter()
  const supabase = createClient()

  const [enrollment, setEnrollment] = useState<PendingEnrollment | null>(null)
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStartEnroll() {
    setPending(true)
    setError(null)
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setPending(false)
    if (enrollError || !data) {
      setError(enrollError?.message ?? 'Could not start enrollment. Try again.')
      return
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
  }

  function handleCancelEnroll() {
    setEnrollment(null)
    setCode('')
    setError(null)
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault()
    if (!enrollment || !isValidTotpCode(code)) return

    setPending(true)
    setError(null)

    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    })
    if (challengeError || !challenge) {
      setPending(false)
      setError(challengeError?.message ?? 'Could not verify. Try again.')
      return
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code,
    })
    setPending(false)
    if (verifyError) {
      setError('Incorrect code. Check your authenticator app and try again.')
      return
    }

    toast.success('Two-factor authentication is now enabled.')
    setEnrollment(null)
    setCode('')
    router.refresh()
  }

  // Passed straight to ConfirmSubmit as its form `action` — a plain client function
  // (unenroll must run client-side, see the file doc comment above), not a server action.
  async function handleRemove(formData: FormData) {
    const factorId = formData.get('factorId')
    if (typeof factorId !== 'string' || !factorId) return

    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId })
    if (unenrollError) {
      toast.error(unenrollError.message || 'Could not remove the authenticator.')
      return
    }
    toast.success('Two-factor authentication removed.')
    router.refresh()
  }

  // Verified factor(s) already exist — show the list + remove, never the enroll flow.
  if (factors.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Two-factor authentication is enabled. If you lose access to your device, you
          won&apos;t be able to remove it yourself from here — contact whoever manages
          this workspace&apos;s Supabase project; recovering access requires deleting
          the factor from the Supabase dashboard.
        </p>
        <ul className="flex flex-col gap-2">
          {factors.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Authenticator app</span>
                <span className="text-xs text-muted-foreground">
                  Enrolled {formatDate(f.createdAt)}
                </span>
              </div>
              <ConfirmSubmit
                action={handleRemove}
                triggerLabel="Remove"
                triggerVariant="outline"
                triggerSize="sm"
                title="Remove this authenticator?"
                description="Removing two-factor authentication weakens your account's protection. You can set it up again at any time."
                confirmLabel="Remove"
              >
                <input type="hidden" name="factorId" value={f.id} />
              </ConfirmSubmit>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // Mid-enrollment — QR + manual secret + 6-digit verify.
  if (enrollment) {
    return (
      <form onSubmit={handleVerify} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Scan this code with an authenticator app (Google Authenticator, 1Password, Authy,
          etc.), then enter the 6-digit code it shows.
        </p>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {/* Runtime-generated data: URI, not a static asset next/image can optimize. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrollment.qrCode}
            alt="Authenticator app QR code"
            className="size-36 shrink-0 rounded-md border bg-white p-2"
          />
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">
              Can&apos;t scan? Enter this code manually:
            </span>
            <code className="w-fit break-all rounded-md bg-muted px-2 py-1 text-xs">
              {enrollment.secret}
            </code>
          </div>
        </div>

        <FormError message={error} />

        <div className="flex flex-col gap-1.5 sm:max-w-48">
          <Label htmlFor="mfa-code">6-digit code</Label>
          <Input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending || !isValidTotpCode(code)}>
            {pending ? 'Verifying…' : 'Verify'}
          </Button>
          <Button type="button" variant="outline" onClick={handleCancelEnroll} disabled={pending}>
            Cancel
          </Button>
        </div>
      </form>
    )
  }

  // No factor, not mid-enrollment — the starting state.
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Add an authenticator app for a second layer of protection when you sign in.
      </p>
      <FormError message={error} />
      <div>
        <Button type="button" onClick={handleStartEnroll} disabled={pending}>
          {pending ? 'Starting…' : 'Set up authenticator app'}
        </Button>
      </div>
    </div>
  )
}
