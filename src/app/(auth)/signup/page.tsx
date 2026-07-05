import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthPageShell } from '@/components/common/AuthPageShell'
import { signUpWithPassword } from '../actions'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <AuthPageShell title="Create account" error={params.error}>
      <form action={signUpWithPassword} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" required />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" minLength={8} required />
        </div>
        <Button type="submit">Create account</Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <a href="/login" className="underline">Sign in</a>
      </p>
    </AuthPageShell>
  )
}
