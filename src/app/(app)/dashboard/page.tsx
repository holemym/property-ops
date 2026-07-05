import { redirect } from 'next/navigation'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { EmptyState } from '@/components/common/EmptyState'

export default async function DashboardPage() {
  // Tenants/guests have no operator dashboard — land them on their portal instead.
  // (The operator dashboard proper is P3.10; today this is a placeholder EmptyState.)
  const user = await requireWorkspace()
  if (isTenantRole(user.role)) redirect('/portal')

  return (
    <EmptyState
      title="Dashboard coming in Phase 3"
      description="Ticket-driven widgets land once the ticket system exists. For now, manage your portfolio structure."
      actionLabel="Go to Properties"
      actionHref="/properties"
    />
  )
}
