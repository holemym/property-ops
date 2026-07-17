import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isInviteOnly } from '@/lib/auth/signup-mode'
import { isDemoEnabled } from '@/lib/demo'
import { signUpWithPassword } from '../actions'
import { enterDemo } from '../demo-actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; confirmEmailSent?: string }>
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
      <AuthCard title="Check your email">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground">
            <MailCheck className="size-5" aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            We sent a confirmation link to your inbox. Open it to activate your account, then sign
            in.
          </p>
          <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="w-full">
            Back to sign in
          </Button>
        </div>
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
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
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
