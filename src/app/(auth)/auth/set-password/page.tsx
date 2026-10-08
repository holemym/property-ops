import Link from 'next/link'
import { requireUser } from '@/lib/auth/session'
import { AuthCard } from '@/components/auth/AuthCard'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { setPassword } from '../../actions'

// One screen, three arrivals: a freshly-invited user straight off the callback
// (reason=invite), someone who followed a reset link (reason=reset), or a signed-in user
// changing their password from the account menu or Security page (no reason). The
// heading says which, so nobody wonders why they're here. requireUser() is the only
// gate — no workspace needed, and unlike most (auth) pages this one requires a session
// (not in proxy's PUBLIC_PATHS).
const COPY = {
  invite: { title: 'Set your password', description: 'Choose a password to finish setting up your account.' },
  reset: { title: 'Choose a new password', description: 'You signed in with the reset link. Set the password you will use from now on.' },
  change: { title: 'Change your password', description: 'The new password replaces the old one on every device.' },
} as const

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reason?: string }>
}) {
  await requireUser()
  const { error, reason } = await searchParams
  const kind = reason === 'invite' || reason === 'reset' ? reason : 'change'

  return (
    <AuthCard title={COPY[kind].title} description={COPY[kind].description} error={error}>
      <form action={setPassword} className="flex flex-col gap-4">
        {kind !== 'change' && <input type="hidden" name="reason" value={kind} />}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            autoFocus
            required
          />
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
        <Button type="submit" size="lg" className="w-full">
          Save password
        </Button>
      </form>
      {/* A plain change has somewhere to go back to; invite and reset arrivals don't. */}
      {kind === 'change' && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
            Cancel
          </Link>
        </p>
      )}
    </AuthCard>
  )
}
