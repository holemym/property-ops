import { requireUser } from '@/lib/auth/session'
import { AuthCard } from '@/components/auth/AuthCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setPassword } from '../../actions'

// Reached two ways: (1) a freshly-invited user, redirected here straight off the
// callback exchange with no password set yet (see inviteUser's redirectTo `next` param
// in settings/users/actions.ts); (2) any authenticated user visiting directly to change
// their password. requireUser() is the only gate — no workspace needed, and unlike most
// (auth) pages this one requires an existing session (not in proxy's PUBLIC_PATHS).
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireUser()
  const { error } = await searchParams

  return (
    <AuthCard
      title="Set your password"
      description="Choose a password to finish setting up your account."
      error={error}
    >
      <form action={setPassword} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </div>
        <Button type="submit" size="lg" className="w-full">
          Save password
        </Button>
      </form>
    </AuthCard>
  )
}
