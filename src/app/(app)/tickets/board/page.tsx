import Link from 'next/link'
import { LayoutList, Ticket as TicketIcon } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { listTickets, listWorkspaceOperators } from '@/lib/data/tickets'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { KanbanBoard } from '@/components/tickets/board/KanbanBoard'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'

// Kanban board over every workspace ticket, grouped by status. Read is gated at
// tickets:read; the drag-to-transition affordance is gated at tickets:write (managers) —
// everyone else gets the same board read-only. The transition itself goes through the
// board wrapper action (moveTicketStatusAction), which re-gates and re-validates the state
// machine server-side, so canWrite here is purely a UI affordance, not the security line.
export default async function TicketBoardPage() {
  const user = await requirePermission('tickets:read')
  const canWrite = can(user.role, 'tickets:write')

  const supabase = await createClient()
  const [tickets, properties, units, operators] = await Promise.all([
    listTickets(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listWorkspaceOperators(supabase, user.workspaceId),
  ])

  const propertyNames = Object.fromEntries(properties.map((p) => [p.id, p.name]))
  const unitLabels = Object.fromEntries(units.map((u) => [u.id, u.label]))
  const operatorNames = Object.fromEntries(
    operators.filter((o) => o.full_name).map((o) => [o.id, o.full_name as string]),
  )

  // Only the fields the board card renders — keeps the client payload small and the
  // component prop type explicit.
  const boardTickets = tickets.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    status: t.status,
    property_id: t.property_id,
    unit_id: t.unit_id,
    assigned_operator_id: t.assigned_operator_id,
  }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Board"
        subtitle="Drag tickets across the lifecycle, from triage to close."
        actions={
          <Button variant="outline" render={<Link href="/tickets" />} nativeButton={false}>
            <LayoutList className="size-4" />
            List view
          </Button>
        }
      />

      {boardTickets.length === 0 ? (
        <EmptyState
          icon={<TicketIcon />}
          title="No tickets yet"
          body="Open a ticket to track a repair, and it will show up on the board through to close."
          action={
            canWrite ? (
              <Button render={<Link href="/tickets/new" />} nativeButton={false}>New ticket</Button>
            ) : undefined
          }
        />
      ) : (
        <KanbanBoard
          tickets={boardTickets}
          propertyNames={propertyNames}
          unitLabels={unitLabels}
          operatorNames={operatorNames}
          canWrite={canWrite}
        />
      )}
    </div>
  )
}
