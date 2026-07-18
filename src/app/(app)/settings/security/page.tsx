import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/PageHeader'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MfaEnroll } from '@/components/settings/MfaEnroll'

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
    </div>
  )
}
