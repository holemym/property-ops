import { requirePermission } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { inviteUser, setUserActive } from './actions'

export default async function UsersSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
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
      <h1 className="text-xl font-semibold">Users</h1>

      {params.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{params.error}</p>
      )}

      <form action={inviteUser} className="flex items-end gap-2">
        <Input name="email" type="email" placeholder="teammate@company.com" required className="w-64" />
        <select name="role" className="h-9 rounded-md border px-2 text-sm" defaultValue="OPERATOR">
          <option value="OPERATOR">Operator</option>
          <option value="ACCOUNTANT">Accountant</option>
          <option value="OWNER">Owner</option>
        </select>
        <Button type="submit">Invite</Button>
      </form>

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
                ) : (
                  <form action={setUserActive}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="isActive" value={String(!u.is_active)} />
                    <Button type="submit" variant="outline" size="sm">
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </form>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
