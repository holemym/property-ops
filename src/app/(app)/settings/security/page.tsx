import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole, can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState } from '@/components/common/EmptyState'
import { MfaEnroll } from '@/components/settings/MfaEnroll'
import { listRecentAuthEvents, authEventLabel } from '@/lib/data/auth-events'
import { relativeDay } from '@/lib/relative-date'

// Reachable by every authenticated non-tenant role (S2-1 spec §2) — tenants/guests get
// the simple self-service portal and have no operator-style account settings, so a direct
// visit bounces them to /portal same as dashboard/tickets/etc. Unlike /settings/users this
// page has NO permission gate: every manager/accountant/owner role may manage their own
// two-factor + password, matching "reachable by every non-tenant role" in the spec.
export default async function SecuritySettingsPage() {
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  const supabase = await createClient()
  // mfa.listFactors() reads the current session server-side — no client round-trip needed
  // just to paint the initial list. Only VERIFIED totp factors are shown; an abandoned
  // unverified enrollment (user started, never scanned/confirmed) is not a "factor" from
  // the account owner's point of view and starting over just creates a fresh one.
  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const factors = (factorsData?.totp ?? [])
    .filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, createdAt: f.created_at }))

  // S2-2: admin-only audit log section, gated exactly like /settings/users
  // (users:invite — SUPER_ADMIN/OWNER only, narrower than every other role
  // that reaches this page). The query only runs when the section will
  // render — no point reading rows the caller isn't allowed to act on, and
  // it doubles as RLS's own belt-and-suspenders (auth_events_select_admin,
  // migration 0028, gates on the same tier at the DB layer independently).
  const canSeeAuditLog = can(user.role, 'users:invite')
  const events = canSeeAuditLog ? await listRecentAuthEvents(supabase, user.workspaceId) : []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        subtitle="Manage two-factor authentication and your password."
      />

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Require a 6-digit code from an authenticator app in addition to your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MfaEnroll factors={factors} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Password</CardTitle>
          <CardDescription>Change the password used to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            render={<Link href="/auth/set-password" />}
            nativeButton={false}
          >
            Change password
          </Button>
        </CardContent>
      </Card>

      {/* S2-2: admin-only (users:invite tier — SUPER_ADMIN/OWNER). Invisible to
          every other role reaching this page, including OPERATOR/ACCOUNTANT. */}
      {canSeeAuditLog && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>
              Sign-ins, sign-outs, password changes, and account changes for this workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <EmptyState
                title="No activity recorded yet"
                body="Sign-ins and account changes for this workspace will appear here."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>IP address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell title={new Date(e.created_at).toLocaleString()}>
                        {relativeDay(e.created_at)}
                      </TableCell>
                      <TableCell>{authEventLabel(e.event_type)}</TableCell>
                      <TableCell>{e.email ?? '—'}</TableCell>
                      <TableCell>{e.ip ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
