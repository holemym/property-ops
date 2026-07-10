import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/layout/PageHeader'
import { FormError } from '@/components/common/FormError'
import { ConfirmSubmit } from '@/components/common/ConfirmSubmit'
import { isDemoEnabled, canManuallyResetDemo } from '@/lib/demo'
import { inviteUser, setUserActive, resetDemoWorkspaceManually } from './actions'

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; resetDemo?: string }>
}) {
  const params = await searchParams
  const admin = await requirePermission('users:invite')
  const supabase = await createClient()
  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active')
    .eq('workspace_id', admin.workspaceId)
    .order('full_name')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        subtitle="Manage who can access this workspace and their roles."
      />

      <FormError message={params.error} />

      <form action={inviteUser} className="flex items-end gap-2">
        <Input
          name="email"
          type="email"
          placeholder="teammate@company.com"
          required
          aria-label="Teammate email address"
          className="w-64"
        />
        <select
          name="role"
          aria-label="Role"
          className="h-9 rounded-md border px-2 text-sm"
          defaultValue="OPERATOR"
        >
          <option value="OPERATOR">Operator</option>
          <option value="ACCOUNTANT">Accountant</option>
          <option value="OWNER">Owner</option>
        </select>
        <Button type="submit">Invite</Button>
      </form>

      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides).
          Rows carry an activate/deactivate form, so the card is a plain div (not a Link)
          with the form's server action nested and unchanged. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium leading-snug">{u.full_name || '—'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{u.role}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {u.is_active ? 'Active' : 'Deactivated'}
              </span>
              {u.id === admin.id ? (
                <span className="text-sm text-muted-foreground">(you)</span>
              ) : u.is_active ? (
                <ConfirmSubmit
                  action={setUserActive}
                  triggerLabel="Deactivate"
                  triggerSize="sm"
                  title="Deactivate this user?"
                  description="They'll immediately lose access to the workspace. You can reactivate them later."
                  confirmLabel="Deactivate"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="isActive" value="false" />
                </ConfirmSubmit>
              ) : (
                <form action={setUserActive}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="isActive" value="true" />
                  <Button type="submit" variant="outline" size="sm">
                    Activate
                  </Button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(users ?? []).map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.full_name || '—'}</TableCell>
              <TableCell>{u.role}</TableCell>
              <TableCell>{u.is_active ? 'Active' : 'Deactivated'}</TableCell>
              <TableCell>
                {u.id === admin.id ? (
                  <span className="text-sm text-muted-foreground">(you)</span>
                ) : u.is_active ? (
                  <ConfirmSubmit
                    action={setUserActive}
                    triggerLabel="Deactivate"
                    triggerSize="sm"
                    title="Deactivate this user?"
                    description="They'll immediately lose access to the workspace. You can reactivate them later."
                    confirmLabel="Deactivate"
                  >
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="isActive" value="false" />
                  </ConfirmSubmit>
                ) : (
                  <form action={setUserActive}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="isActive" value="true" />
                    <Button type="submit" variant="outline" size="sm">
                      Activate
                    </Button>
                  </form>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>

      {/* D7: emergency manual demo reset. Invisible for every role but SUPER_ADMIN
          (canManuallyResetDemo), and only while the demo sandbox is enabled at all —
          mirrors the resetDemoWorkspaceManually action's own authorization check. */}
      {isDemoEnabled() && canManuallyResetDemo(admin.role) && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div>
            <h2 className="text-sm font-semibold">Demo workspace reset</h2>
            <p className="text-sm text-muted-foreground">
              Immediately wipe and reseed the public demo workspace instead of waiting
              for the next visitor to trigger the 24-hour automatic reset. Signs out
              everyone currently using the demo. Super admin only.
            </p>
          </div>
          {params.resetDemo === 'ok' && (
            <p role="status" className="text-sm text-muted-foreground">
              Demo workspace reset.
            </p>
          )}
          <div>
            <ConfirmSubmit
              action={resetDemoWorkspaceManually}
              triggerLabel="Reset demo workspace"
              triggerVariant="outline"
              triggerSize="sm"
              title="Reset the demo workspace now?"
              description="This immediately wipes and reseeds the public demo workspace and signs out every visitor currently attached to it. This cannot be undone."
              confirmLabel="Reset now"
            />
          </div>
        </div>
      )}
    </div>
  )
}
