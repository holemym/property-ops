'use client'

import { useMemo, useState, useTransition, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { StatusBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { statusBadge } from '@/lib/status'
import { nextStatuses } from '@/lib/tickets/status-flow'
import { moveTicketStatusAction } from '@/app/(app)/tickets/board/actions'
import type { Ticket } from '@/lib/data/tickets'
import type { TicketStatus, TicketPriority } from '@/types/domain'

// Column order follows the ticket lifecycle (status-flow.ts): the happy path left→right,
// with the two off-path states (waiting for info, cancelled) trailing. Each column maps to
// exactly ONE concrete status so a drop is an unambiguous transition target.
const COLUMN_ORDER: TicketStatus[] = [
  'NEW',
  'TRIAGE',
  'ASSIGNED',
  'SCHEDULED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
  'WAITING_FOR_INFO',
  'CANCELLED',
]

type BoardTicket = Pick<Ticket, 'id' | 'title' | 'priority' | 'status' | 'property_id' | 'unit_id'> & {
  assigned_operator_id: string | null
}

const statusLabel = (s: TicketStatus) => statusBadge('ticket_status', s).label

// Left color-spine on each card so urgency reads at a glance across the board.
const PRIORITY_SPINE: Record<TicketPriority, string> = {
  URGENT: 'border-l-red-500',
  HIGH: 'border-l-amber-500',
  NORMAL: 'border-l-transparent',
  LOW: 'border-l-transparent',
}

export function KanbanBoard({
  tickets,
  propertyNames,
  unitLabels,
  operatorNames,
  canWrite,
}: {
  tickets: BoardTicket[]
  propertyNames: Record<string, string>
  unitLabels: Record<string, string>
  operatorNames: Record<string, string>
  canWrite: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Local status overrides give the optimistic move: on a valid drop we flip the card's
  // status immediately, then reconcile with the server. On rejection we clear the override
  // so the card snaps back to its real column.
  const [overrides, setOverrides] = useState<Record<string, TicketStatus>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [overColumn, setOverColumn] = useState<TicketStatus | null>(null)

  const statusOf = useCallback(
    (t: BoardTicket): TicketStatus => overrides[t.id] ?? t.status,
    [overrides],
  )

  const columns = useMemo(() => {
    const grouped: Record<TicketStatus, BoardTicket[]> = Object.fromEntries(
      COLUMN_ORDER.map((s) => [s, [] as BoardTicket[]]),
    ) as Record<TicketStatus, BoardTicket[]>
    for (const t of tickets) grouped[statusOf(t)]?.push(t)
    return grouped
  }, [tickets, statusOf])

  const draggedTicket = dragId ? tickets.find((t) => t.id === dragId) ?? null : null
  const legalTargets = draggedTicket ? nextStatuses(statusOf(draggedTicket)) : []

  // The one move path, shared by drag-and-drop (mouse) and the per-card "Move to…" select
  // (touch + keyboard). Validates against the state machine, flips optimistically, then
  // reconciles with the server and snaps back on rejection.
  function moveTicket(id: string, from: TicketStatus, target: TicketStatus, title: string) {
    if (from === target) return
    if (!nextStatuses(from).includes(target)) {
      toast.error(`Can't move "${title}" from ${statusLabel(from)} to ${statusLabel(target)}.`)
      return
    }
    setOverrides((prev) => ({ ...prev, [id]: target }))
    startTransition(async () => {
      const result = await moveTicketStatusAction(id, target)
      if (!result.ok) {
        setOverrides((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        toast.error(result.error)
        return
      }
      // Refresh so the server-rendered board is the source of truth; once fresh props
      // arrive the override for this id becomes a no-op.
      router.refresh()
    })
  }

  function handleDrop(target: TicketStatus) {
    setOverColumn(null)
    const id = dragId
    setDragId(null)
    if (!id) return
    const ticket = tickets.find((t) => t.id === id)
    if (!ticket) return
    moveTicket(id, statusOf(ticket), target, ticket.title)
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMN_ORDER.map((status) => {
        const cards = columns[status]
        const isDropTarget = canWrite && dragId !== null && legalTargets.includes(status)
        const isActiveOver = isDropTarget && overColumn === status
        return (
          <section
            key={status}
            aria-label={`${statusLabel(status)} column`}
            onDragOver={(e) => {
              if (!isDropTarget) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (overColumn !== status) setOverColumn(status)
            }}
            onDragLeave={(e) => {
              // Only clear when the pointer actually leaves the column, not on child enters.
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setOverColumn((c) => (c === status ? null : c))
              }
            }}
            onDrop={(e) => {
              if (!isDropTarget) return
              e.preventDefault()
              handleDrop(status)
            }}
            className={cn(
              'flex w-72 shrink-0 flex-col rounded-xl bg-muted/40 ring-1 ring-foreground/10 motion-safe:transition-colors',
              isDropTarget && 'ring-foreground/25',
              isActiveOver && 'bg-muted ring-2 ring-primary/50',
            )}
          >
            <header className="flex items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <StatusBadge kind="ticket_status" value={status} />
              </div>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {cards.length}
              </span>
            </header>

            <div className="flex min-h-24 flex-col gap-2 px-2 pb-2">
              {cards.length === 0 ? (
                <p
                  className={cn(
                    'rounded-md px-1 py-6 text-center text-xs text-muted-foreground',
                    isActiveOver && 'border-2 border-dashed border-primary/50 text-primary',
                  )}
                >
                  {isActiveOver ? 'Drop to move here' : 'No tickets'}
                </p>
              ) : (
                <>
                  {cards.map((t) => (
                    <BoardCard
                      key={t.id}
                      ticket={t}
                      propertyName={propertyNames[t.property_id]}
                      unitLabel={t.unit_id ? unitLabels[t.unit_id] : undefined}
                      operatorName={t.assigned_operator_id ? operatorNames[t.assigned_operator_id] : undefined}
                      canWrite={canWrite}
                      isDragging={dragId === t.id}
                      isPending={isPending && overrides[t.id] === status}
                      targets={nextStatuses(status)}
                      onMove={(target) => moveTicket(t.id, status, target, t.title)}
                      onDragStart={() => setDragId(t.id)}
                      onDragEnd={() => {
                        setDragId(null)
                        setOverColumn(null)
                      }}
                    />
                  ))}
                  {/* Insertion placeholder while dragging over a non-empty legal column. */}
                  {isActiveOver && (
                    <div className="rounded-lg border-2 border-dashed border-primary/50 px-3 py-4 text-center text-xs font-medium text-primary">
                      Drop to move here
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({
  ticket,
  propertyName,
  unitLabel,
  operatorName,
  canWrite,
  isDragging,
  isPending,
  targets,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  ticket: BoardTicket
  propertyName?: string
  unitLabel?: string
  operatorName?: string
  canWrite: boolean
  isDragging: boolean
  isPending: boolean
  targets: TicketStatus[]
  onMove: (target: TicketStatus) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const location = [propertyName ?? '—', unitLabel].filter(Boolean).join(' · ')
  return (
    <div
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border-l-2 bg-card p-3 text-sm ring-1 ring-foreground/10 motion-safe:transition-shadow',
        PRIORITY_SPINE[ticket.priority],
        isDragging && 'opacity-50',
        isPending && 'opacity-70',
        !isDragging && 'hover:ring-foreground/20',
      )}
    >
      <div className="flex items-start gap-1.5">
        {canWrite && (
          // The drag handle carries the draggable behaviour so a plain click on the card
          // body still navigates via the stretched link below. Managers only; a read-only
          // board shows no handle and nothing is draggable.
          <button
            type="button"
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            aria-label={`Drag ${ticket.title}`}
            className="relative z-10 -ml-0.5 mt-0.5 cursor-grab touch-none rounded text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <Link
          href={`/tickets/${ticket.id}`}
          className="font-medium leading-snug after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
        >
          {ticket.title}
        </Link>
      </div>

      <div className="relative z-10 flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="ticket_priority" value={ticket.priority} />
      </div>

      <p className="text-xs text-muted-foreground">{location}</p>

      {operatorName && (
        <p className="truncate text-xs text-muted-foreground">Assigned to {operatorName}</p>
      )}

      {/* Touch/keyboard move affordance — the drag handle above is mouse-only (HTML5 DnD
          doesn't fire on touch), so this native select gives every input a way to move a
          card. `value=""` keeps it a stateless "picker" that resets after each choice. */}
      {canWrite && targets.length > 0 && (
        <select
          aria-label={`Move ${ticket.title} to another status`}
          value=""
          onChange={(e) => {
            if (e.target.value) onMove(e.target.value as TicketStatus)
          }}
          className="relative z-10 h-7 rounded-md border border-border bg-background px-1.5 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Move to…</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
