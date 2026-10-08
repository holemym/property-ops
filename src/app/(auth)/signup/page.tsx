import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { AuthCard } from '@/components/auth/AuthCard'
import { PasswordInput } from '@/components/auth/PasswordInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isInviteOnly } from '@/lib/auth/signup-mode'
import { isDemoEnabled } from '@/lib/demo'
import { signUpWithPassword, resendConfirmation } from '../actions'
import { enterDemo } from '../demo-actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; confirmEmailSent?: string; resent?: string }>
}) {
  const params = await searchParams

  if (isInviteOnly()) {
    const demoEnabled = isDemoEnabled()
    return (
      <AuthCard
        title={
          demoEnabled
            ? 'Accounts are by invitation — or explore the demo with sample data'
            : 'Accounts are by invitation'
        }
        error={params.error}
      >
        <p className="text-sm text-muted-foreground">
          Ask your workspace administrator to invite you from Settings → Users. Already
          have an invite?
        </p>
        <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="mt-4 w-full">
          Go to sign in
        </Button>
        {demoEnabled && (
          <form action={enterDemo} className="mt-2.5">
            <Button type="submit" variant="outline" size="lg" className="w-full">
              Explore the demo
            </Button>
          </form>
        )}
      </AuthCard>
    )
  }

  if (params.confirmEmailSent) {
    return (
      <AuthCard title="Check your email" error={params.error}>
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground">
            <MailCheck className="size-5" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            {params.resent
              ? 'If that account still needs confirming, a new link is on its way.'
              : 'We sent a confirmation link. Open it in this browser to activate your account.'}
          </p>
          <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="w-full">
            Back to sign in
          </Button>
        </div>

        {/* The two ways this screen strands people: the email never arrives, or the
            address already had an account (Supabase then sends nothing and says nothing,
            by design). Both get a next step here without revealing which case it is. */}
        <form action={resendConfirmation} className="mt-5 flex flex-col gap-2 border-t pt-5">
          <Label htmlFor="resend-email" className="text-muted-foreground">
            No email? Send the link again
          </Label>
          <div className="flex gap-2">
            <Input id="resend-email" name="email" type="email" autoComplete="email" required />
            <Button type="submit" variant="outline" className="shrink-0">
              Resend
            </Button>
          </div>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/forgot-password" className="font-medium text-foreground underline-offset-4 hover:underline">
            Reset your password
          </Link>
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Create account"
      description="Set up your property operations workspace."
      error={params.error}
    >
      <form action={signUpWithPassword} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" autoComplete="name" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
          {/* Mirrors passwordSchema (min 10) — with minLength=8 the browser passed
              9-char passwords that zod then rejected, and the error round-trip wiped
              every field the user had typed. */}
          <p className="text-xs text-muted-foreground">At least 10 characters.</p>
        </div>
        <Button type="submit" size="lg" className="w-full">
          Create account
        </Button>
      </form>

      {isDemoEnabled() && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            <span>or</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <form action={enterDemo}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              Explore the demo
            </Button>
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
