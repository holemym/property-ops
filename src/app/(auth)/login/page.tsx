import Link from 'next/link'

import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { isDemoEnabled } from '@/lib/demo'
import { isGoogleAuthEnabled } from '@/lib/auth/providers'
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

        {/* Only rendered when the Supabase project actually has the Google provider
            enabled (NEXT_PUBLIC_AUTH_GOOGLE=1 — see lib/auth/providers.ts): the button
            was live while the provider was off, a guaranteed dead end for testers. */}
        {isGoogleAuthEnabled() && (
          <form action={signInWithGoogle}>
            <Button type="submit" variant="outline" size="lg" className="w-full">
              <GoogleGlyph className="size-4" />
              Continue with Google
            </Button>
          </form>
        )}

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

// Standard multi-color Google "G" mark. Inline SVG (no new dependency) so the provider
// button reads as Google's own affordance rather than a generic outline button — the
// only place brand color appears outside the graphite/status system, matching how every
// other OAuth-style provider glyph is conventionally rendered at true brand color.
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.6 15.6 18.9 12 24 12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4c-7.5 0-14 4.2-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 35 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.9 39.7 16.4 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.6C41.9 35.7 44 30.3 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  )
}
