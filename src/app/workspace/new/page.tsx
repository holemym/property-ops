import { redirect } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthPageShell } from '@/components/common/AuthPageShell'
import { requireUser } from '@/lib/auth/session'
import { createWorkspace } from './actions'

export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await requireUser()
  if (user.workspaceId) redirect('/dashboard')

  const params = await searchParams

  return (
    <AuthPageShell title="Create your workspace" error={params.error}>
      <p className="text-sm text-muted-foreground">
        Your workspace holds your properties, units, vendors, and everything else. You&apos;ll be
        the Owner.
      </p>

      <form action={createWorkspace} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="name">Workspace name</Label>
          <Input id="name" name="name" required placeholder="Acme Properties" />
        </div>
        <div>
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" name="currency" defaultValue="EUR" maxLength={3} />
        </div>
        <Button type="submit">Create workspace</Button>
      </form>
    </AuthPageShell>
  )
}
