import { redirect } from 'next/navigation'
import { FileText } from 'lucide-react'
import { requireWorkspace } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { listDocuments, DOCUMENTS_BUCKET } from '@/lib/data/documents'
import { getUnit, type Unit } from '@/lib/data/units'
import { getProperty } from '@/lib/data/properties'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format-date'
import type { Document } from '@/types/domain'

// Sign a document's download URL for a tenant. Uses the SERVICE-ROLE client —
// storage.objects' documents_objects_select policy (0018) requires an operator/
// accountant role, which TENANT never holds, and the object path
// (`workspace_id/<uuid>-file`) has no per-tenant segment to key a policy on. This is
// safe ONLY because the caller passes a `doc` that already came back from listDocuments
// under the tenant's OWN RLS-scoped client (documents_select_own_tenant, migration
// 0030) — never a client-supplied path. Mirrors the vendor job-token page's service-
// role signing after out-of-band authorization (src/app/job/[token]/page.tsx).
async function signForTenant(doc: Document): Promise<string | null> {
  try {
    const { data } = await createServiceClient()
      .storage.from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function PortalDocumentsPage() {
  const user = await requireWorkspace()
  if (!isTenantRole(user.role)) redirect('/tickets')

  const supabase = await createClient()

  // Reused VERBATIM — documents_select_own_tenant (migration 0030) transparently
  // narrows this to the tenant's own lease/unit/property documents. No app-side
  // tenant filter is applied (or possible) here; RLS is the entire boundary.
  const documents = await listDocuments(supabase, user.workspaceId)

  // Resolve unit/property LABELS only (both open-select to workspace members, 0003/0009)
  // — never tenancy labels, which are manager-gated and unnecessary PII on the tenant's
  // own lease. Ids come only from the tenant's own already-RLS-scoped documents.
  const unitIds = [...new Set(documents.map((d) => d.unit_id).filter((id): id is string => Boolean(id)))]
  const units = await Promise.all(unitIds.map((id) => getUnit(supabase, user.workspaceId, id)))
  const unitById = new Map(
    units.filter((u): u is Unit => u !== null).map((u) => [u.id, u])
  )

  const propertyIds = new Set(
    documents.map((d) => d.property_id).filter((id): id is string => Boolean(id))
  )
  for (const unit of unitById.values()) propertyIds.add(unit.property_id)
  const properties = await Promise.all([...propertyIds].map((id) => getProperty(supabase, user.workspaceId, id)))
  const propertyNameById = new Map(
    properties.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => [p.id, p.name])
  )

  const rows = await Promise.all(
    documents.map(async (doc) => ({ doc, url: await signForTenant(doc) }))
  )

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />

      <PageHeader
        title="My documents"
        subtitle="Your lease, certificates, and other documents shared by your property manager."
      />

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No documents yet"
          body="Documents your property manager shares with you will appear here."
        />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {rows.map(({ doc, url }) => {
              const unit = doc.unit_id ? unitById.get(doc.unit_id) : undefined
              const propertyName = doc.property_id
                ? propertyNameById.get(doc.property_id)
                : unit
                  ? propertyNameById.get(unit.property_id)
                  : undefined
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3.5"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="truncate text-sm font-medium text-foreground">{doc.title}</span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="capitalize">
                        {doc.document_type.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                      <span>{formatDate(doc.created_at)}</span>
                      <span>· {formatBytes(doc.file_size)}</span>
                      {(unit || propertyName) && (
                        <span className="truncate">
                          · {unit ? unit.label : propertyName}
                        </span>
                      )}
                      {doc.expires_at && (
                        <Badge variant="outline">Expires {formatDate(doc.expires_at)}</Badge>
                      )}
                    </span>
                  </div>
                  <div className="ml-auto shrink-0">
                    {url ? (
                      <a
                        href={url}
                        download={doc.title}
                        className="text-sm underline underline-offset-2"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">Link unavailable</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
