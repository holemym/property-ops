import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signInWithPassword, signInWithMagicLink, signInWithGoogle } from '../actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; magicLinkSent?: string; confirmEmailSent?: string }>
}) {
  const params = await searchParams

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>

      {params.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{params.error}</p>
      )}
      {params.magicLinkSent && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          Check your email for a sign-in link.
        </p>
      )}
      {params.confirmEmailSent && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          Check your email to confirm your account.
        </p>
      )}

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
    </div>
  )
}
