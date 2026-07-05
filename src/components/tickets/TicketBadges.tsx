import { Badge } from '@/components/ui/badge'
import type { TicketPriority, TicketStatus } from '@/types/domain'

// Ticket status (9) and priority (4) are DIFFERENT enums from EntityStatus/UnitStatus,
// so StatusBadge (typed `EntityStatus | UnitStatus`) deliberately does NOT cover them.
// These two badges are the ticket-specific analog, following the same dark:-variant TONE
// convention as StatusBadge rather than overloading it. Labels `.replace(/_/g,' ')`.

const STATUS_TONE: Record<TicketStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  TRIAGE: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  WAITING_FOR_INFO: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
  ASSIGNED: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
  SCHEDULED: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/20 dark:text-cyan-400',
  IN_PROGRESS: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-400',
  RESOLVED: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  CLOSED: 'bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-400',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
}

const PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
  NORMAL: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  HIGH: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
  URGENT: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
}

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return (
    <Badge className={STATUS_TONE[status]} variant="secondary">
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <Badge className={PRIORITY_TONE[priority]} variant="secondary">
      {priority.replace(/_/g, ' ')}
    </Badge>
  )
}
