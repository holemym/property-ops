import { Badge } from '@/components/ui/badge'
import type { EntityStatus, UnitStatus } from '@/types/domain'

// The prop is tightened to `EntityStatus | UnitStatus` (both enums now exist, from
// Task 13 and Task 18) so mismatched/misspelled status values get caught at compile
// time instead of silently falling through to the default gray tone below. The TONE
// map covers every member of both unions: ACTIVE/ARCHIVED (EntityStatus) and
// OCCUPIED/VACANT/MAINTENANCE/BLOCKED (UnitStatus).
const TONE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  ARCHIVED: 'bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400',
  OCCUPIED: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  VACANT: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  MAINTENANCE: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400',
  BLOCKED: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
}

export function StatusBadge({ status }: { status: EntityStatus | UnitStatus }) {
  return (
    <Badge
      className={TONE[status] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400'}
      variant="secondary"
    >
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}
