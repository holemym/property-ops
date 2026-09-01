import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format-date'
import type { Document } from '@/types/domain'
import {
  attachedEntityLabel,
  documentTypeLabel,
  documentTypeTone,
  formatFileSize,
  residentVisibility,
  type EntityMaps,
} from './document-display'
import { EditDocumentDialog, type EditEntityOptions } from './EditDocumentDialog'

// The documents repo table. Each row carries a pre-signed download URL (60s TTL, signed
// server-side against the private documents bucket); a null url means signing failed for
// that path, so its link is omitted rather than crashing the render. The page resolves
// each document's single attached entity to a { kind, name } label via the entity maps —
// "Unit · Top 1", "Property · Ringstrasse Residenz", or an em dash when workspace-level.
// Attachment also drives resident-portal visibility (RLS 0030), surfaced per row as a
// "Resident-visible" hint (residentVisibility — derived from the row, no extra queries).
// When `edit` is provided (writers only — the page gates on the same canWrite as the
// upload), each row gets an Edit dialog for metadata + re-attach/detach.
export function DocumentsTable({
  rows,
  maps,
  edit,
}: {
  rows: { doc: Document; url: string | null }[]
  maps: EntityMaps
  edit?: {
    action: (id: string, formData: FormData) => void | Promise<void>
    entities: EditEntityOptions
  }
}) {
  const editDialog = (doc: Document) =>
    edit ? (
      <EditDocumentDialog
        action={edit.action.bind(null, doc.id)}
        entities={edit.entities}
        doc={{
          id: doc.id,
          title: doc.title,
          notes: doc.notes,
          expiresAt: doc.expires_at,
          propertyId: doc.property_id,
          unitId: doc.unit_id,
          tenancyId: doc.tenancy_id,
          vendorId: doc.vendor_id,
          ticketId: doc.ticket_id,
        }}
      />
    ) : null

  return (
    <>
      {/* Mobile: stacked cards (the table's columns don't fit a phone; below sm it hides).
          Rows have no detail page — each card is a plain div with the download link nested. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map(({ doc, url }) => {
          const entity = attachedEntityLabel(doc, maps)
          const visibility = residentVisibility(doc)
          return (
            <li key={doc.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
              <span className="font-medium leading-snug">{doc.title}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={documentTypeTone(doc.document_type)}>
                  {documentTypeLabel(doc.document_type)}
                </Badge>
                {visibility && (
                  <Badge variant="outline" title={visibility.hint}>
                    Resident-visible
                  </Badge>
                )}
                {url ? (
                  <a
                    href={url}
                    download={doc.title}
                    className="text-xs underline underline-offset-2 hover:text-foreground"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Link unavailable</span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 truncate">
                  {entity ? (
                    <>
                      <span className="text-foreground/70">{entity.kind}</span> · {entity.name}
                    </>
                  ) : (
                    '—'
                  )}
                </span>
                <span className="shrink-0">
                  {formatDate(doc.created_at)} · {formatFileSize(doc.file_size)}
                  {doc.expires_at ? ` · exp ${formatDate(doc.expires_at)}` : ''}
                </span>
              </div>
              {edit && <div className="flex justify-end">{editDialog(doc)}</div>}
            </li>
          )
        })}
      </ul>

      {/* Desktop: the full table. */}
      <div className="hidden overflow-hidden rounded-lg border sm:block">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-4">Title</TableHead>
            <TableHead className="px-4">Type</TableHead>
            <TableHead className="px-4">Attached to</TableHead>
            <TableHead className="px-4">Expires</TableHead>
            <TableHead className="px-4">Uploaded</TableHead>
            <TableHead className="px-4">Size</TableHead>
            <TableHead className="px-4 text-right">{edit ? 'Actions' : 'Download'}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ doc, url }) => {
            const entity = attachedEntityLabel(doc, maps)
            const visibility = residentVisibility(doc)
            return (
              <TableRow key={doc.id}>
                <TableCell className="px-4 py-3 font-medium">{doc.title}</TableCell>
                <TableCell className="px-4 py-3">
                  <Badge variant={documentTypeTone(doc.document_type)}>
                    {documentTypeLabel(doc.document_type)}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {entity ? (
                      <span>
                        <span className="text-foreground/70">{entity.kind}</span> · {entity.name}
                      </span>
                    ) : (
                      '—'
                    )}
                    {visibility && (
                      <Badge variant="outline" title={visibility.hint}>
                        Resident-visible
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {formatDate(doc.expires_at)}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {formatDate(doc.created_at)}
                </TableCell>
                <TableCell className="px-4 py-3 text-muted-foreground">
                  {formatFileSize(doc.file_size)}
                </TableCell>
                <TableCell className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-2">
                    {url ? (
                      <a
                        href={url}
                        download={doc.title}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Link unavailable</span>
                    )}
                    {editDialog(doc)}
                  </span>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      </div>
    </>
  )
}
