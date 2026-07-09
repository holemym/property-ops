import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/EmptyState'
import { formatDate } from '@/lib/format-date'
import type { Document } from '@/types/domain'

// Documents attached to this property. Each row shows the title, a document-type badge,
// and (when set) the expiry date — rendered amber when it falls within the next 90 days
// (or is already past due), otherwise muted. Self-contained; no byte access / URL signing
// (the documents page owns downloads), just a per-property attachment summary.

const EXPIRY_WINDOW_DAYS = 90

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function DocumentsList({ documents }: { documents: Document[] }) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileText />}
        title="No documents yet"
        body="Leases, permits, certificates, and other files attached to this property will appear here."
      />
    )
  }

  // Amber threshold: expiring within the next 90 days, or already past due.
  const windowEnd = new Date()
  windowEnd.setHours(0, 0, 0, 0)
  windowEnd.setDate(windowEnd.getDate() + EXPIRY_WINDOW_DAYS)

  return (
    <ul className="-mx-2 flex flex-col">
      {documents.map((d) => {
        const expiresAt = d.expires_at ? new Date(d.expires_at) : null
        const soon = expiresAt !== null && expiresAt <= windowEnd
        return (
          <li
            key={d.id}
            className="flex items-center gap-3 rounded-lg px-2 py-2"
          >
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">{d.title}</span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="muted">{titleCase(d.document_type)}</Badge>
                {expiresAt && (
                  <span
                    className={
                      soon
                        ? 'text-xs font-medium text-amber-700 dark:text-amber-400'
                        : 'text-xs text-muted-foreground'
                    }
                  >
                    Expires {formatDate(d.expires_at)}
                  </span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
