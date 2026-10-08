import Link from 'next/link'
import { MailCheck } from 'lucide-react'

import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { requestPasswordReset } from '../actions'

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>
}) {
  const params = await searchParams

  if (params.sent) {
    return (
      <AuthCard title="Check your email">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-foreground">
            <MailCheck className="size-5" aria-hidden />
          </div>
          {/* Same message whether or not the address has an account — the form must not
              reveal which emails are registered. */}
          <p className="text-sm text-muted-foreground">
            If an account exists for that address, a reset link is on its way. Open it in this
            browser; the link works once.
          </p>
          <Button render={<Link href="/login" />} nativeButton={false} size="lg" className="w-full">
            Back to sign in
          </Button>
          <Link
            href="/forgot-password"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            No email after a few minutes? Send it again
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you sign in with. We'll send a link to choose a new password."
      error={params.error}
    >
      <form action={requestPasswordReset} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" autoFocus required />
        </div>
        <Button type="submit" size="lg" className="w-full">
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{' '}
        <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  )
}
