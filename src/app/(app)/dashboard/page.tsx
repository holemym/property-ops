import { EmptyState } from '@/components/common/EmptyState'

export default function DashboardPage() {
  return (
    <EmptyState
      title="Dashboard coming in Phase 3"
      description="Ticket-driven widgets land once the ticket system exists. For now, manage your portfolio structure."
      actionLabel="Go to Properties"
      actionHref="/properties"
    />
  )
}
