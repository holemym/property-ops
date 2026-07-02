import { Badge } from '@/components/ui/badge'

const TONE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  ARCHIVED: 'bg-gray-100 text-gray-600',
  OCCUPIED: 'bg-blue-100 text-blue-800',
  VACANT: 'bg-amber-100 text-amber-800',
  MAINTENANCE: 'bg-orange-100 text-orange-800',
  BLOCKED: 'bg-red-100 text-red-800',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={TONE[status] ?? 'bg-gray-100 text-gray-700'} variant="secondary">
      {status.replace(/_/g, ' ')}
    </Badge>
  )
}
