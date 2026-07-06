import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'

// The root path is never a real page in this app. Unauthenticated visitors are bounced
// to /login by the proxy before they get here; authenticated ones land role-appropriately:
// tenants/guests to their portal, everyone else to the operator dashboard. (requireWorkspace
// handles the logged-in-but-no-workspace case by redirecting to workspace creation.)
export default async function Home() {
  const user = await requireWorkspace()
  redirect(isTenantRole(user.role) ? '/portal' : '/dashboard')
}
