import Link from 'next/link'

import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isDemoEnabled } from '@/lib/demo'
import { signInWithPassword, signInWithMagicLink, signInWithGoogle } from '../actions'
import { enterDemo } from '../demo-actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; magicLinkSent?: string }>
}) {
  const params = await searchParams

  return (
    <AuthCard
      title="Sign in"
      description="Access your property operations workspace."
      error={params.error}
    >
      {params.magicLinkSent && (
        <div
          role="status"
          className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          Check your email for a sign-in link.
        </div>
      )}

      <form action={signInWithPassword} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" size="lg" className="w-full">
          Sign in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span>or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex flex-col gap-2.5">
        <form action={signInWithMagicLink} className="flex flex-col gap-1.5">
          <Label htmlFor="magic-email" className="text-muted-foreground">
            Email for magic link
          </Label>
          <Input id="magic-email" name="email" type="email" autoComplete="email" required />
          <Button type="submit" variant="outline" size="lg" className="mt-1 w-full">
            Send magic link
          </Button>
        </form>

        <form action={signInWithGoogle}>
          <Button type="submit" variant="outline" size="lg" className="w-full">
            Continue with Google
          </Button>
        </form>

        {isDemoEnabled() && (
          <form action={enterDemo}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              Explore the demo
            </Button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{' '}
        <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Sign up
        </Link>
      </p>
    </AuthCard>
  )
}
