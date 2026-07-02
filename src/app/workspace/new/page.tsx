import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createWorkspace } from './actions'

export default async function NewWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-2xl font-semibold">Create your workspace</h1>
      <p className="text-sm text-muted-foreground">
        Your workspace holds your properties, units, vendors, and everything else. You&apos;ll be
        the Owner.
      </p>

      {params.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{params.error}</p>
      )}

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
    </div>
  )
}
