import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { AuthCard } from '@/components/auth/AuthCard'
import { requireUser } from '@/lib/auth/session'
import { signOut } from '@/app/(auth)/actions'
import { createWorkspace } from './actions'

// The currencies the product realistically bills in today (DACH-first). Free-text ISO
// input let "EU" through to a raw zod error and cleared the form on the round-trip.
const CURRENCIES = [
  { code: 'EUR', label: 'EUR — Euro' },
  { code: 'CHF', label: 'CHF — Swiss franc' },
  { code: 'GBP', label: 'GBP — British pound' },
  { code: 'USD', label: 'USD — US dollar' },
]

// The create-workspace step sits between sign-up and the app, so it renders in the
// same visual shell as the auth flow (AuthCard + the centered brand column the
// (auth)/layout provides for its own routes — reproduced here because this route
// lives outside that group). This replaced the one-off AuthPageShell, which made
// this single step look unlike the login/signup/MFA pages around it.
export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireUser()
  if (user.workspaceId) redirect('/dashboard')

  const params = await searchParams

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="flex items-center gap-2 text-foreground">
        <Building2 className="size-5" aria-hidden />
        <span className="font-heading text-base font-medium tracking-tight">Property Ops</span>
      </div>
      <AuthCard
        title="Create your workspace"
        description="Your workspace holds your properties, units, vendors, and everything else. You'll be the Owner."
        error={params.error}
      >
        <form action={createWorkspace} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="name">Workspace name</Label>
            <Input id="name" name="name" required placeholder="Acme Properties" />
          </div>
          <div>
            <Label htmlFor="currency">Currency</Label>
            <NativeSelect id="currency" name="currency" defaultValue="EUR">
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit">Create workspace</Button>
        </form>
      </AuthCard>
      {/* Escape hatch: an authenticated workspace-less user can't reach /login (proxy
          bounces them to /dashboard, whose layout bounces back here) — without this,
          being signed into the wrong account meant clearing cookies by hand. */}
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
          Sign out
        </Button>
      </form>
    </main>
  )
}
