import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthPageShell } from '@/components/common/AuthPageShell'
import { signInWithPassword, signInWithMagicLink, signInWithGoogle } from '../actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; magicLinkSent?: string; confirmEmailSent?: string }>
}) {
  const params = await searchParams
  const notice = params.magicLinkSent
    ? 'Check your email for a sign-in link.'
    : params.confirmEmailSent
      ? 'Check your email to confirm your account.'
      : undefined

  return (
    <AuthPageShell title="Sign in" error={params.error} notice={notice}>
      <form action={signInWithPassword} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>
        <Button type="submit">Sign in</Button>
      </form>

      <form action={signInWithMagicLink} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="magic-email">Email for magic link</Label>
          <Input id="magic-email" name="email" type="email" required />
        </div>
        <Button type="submit" variant="secondary">
          Send magic link
        </Button>
      </form>

      <form action={signInWithGoogle}>
        <Button type="submit" variant="outline" className="w-full">
          Continue with Google
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        No account? <a href="/signup" className="underline">Sign up</a>
      </p>
    </AuthPageShell>
  )
}
