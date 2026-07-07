import { CalendarClock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { Document } from '@/types/domain'
import {
  attachedEntityLabel,
  documentTypeLabel,
  type EntityMaps,
} from './document-display'

// An at-a-glance card for documents whose expires_at falls within the next 90 days,
// soonest first. Each row shows the title, its type, the entity it's attached to, and an
// amber days-left pill (red once past due). The page pre-filters + sorts the list; when
// nothing is expiring we show a calm, friendly line rather than an empty card.
export function ExpiringDocuments({
  documents,
  maps,
}: {
  documents: Document[]
  maps: EntityMaps
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-muted-foreground" />
          Expiring documents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing expires in the next 90 days. You&apos;re all set.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {documents.map((doc) => {
              const entity = attachedEntityLabel(doc, maps)
              const days = daysUntil(doc.expires_at as string)
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2.5 first:pt-0 last:pb-0 text-sm"
                >
                  <span className="font-medium text-foreground">{doc.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {documentTypeLabel(doc.document_type)}
                    {entity && <> · {entity.kind} · {entity.name}</>}
                  </span>
                  <Badge variant={days < 0 ? 'red' : 'amber'} className="ml-auto">
                    {expiryLabel(days)}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// Whole days from today (start of day) to the given ISO date. Negative once past due.
function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(iso)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function expiryLabel(days: number): string {
  if (days < 0) {
    const overdue = Math.abs(days)
    return overdue === 1 ? 'Expired 1 day ago' : `Expired ${overdue} days ago`
  }
  if (days === 0) return 'Expires today'
  return days === 1 ? '1 day left' : `${days} days left`
}
