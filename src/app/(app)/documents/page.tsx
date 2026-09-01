import { FileText } from 'lucide-react'
import { requirePermission } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { signStoragePaths } from '@/lib/storage/sign'
import { listDocuments, DOCUMENTS_BUCKET } from '@/lib/data/documents'
import { uploadDocumentAction, updateDocumentAction } from './actions'
import { listProperties } from '@/lib/data/properties'
import { listUnits } from '@/lib/data/units'
import { listTenancies } from '@/lib/data/tenancies'
import { listVendors } from '@/lib/data/vendors'
import { listTickets } from '@/lib/data/tickets'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { ErrorToast } from '@/components/common/ErrorToast'
import { DocumentsTable } from '@/components/documents/DocumentsTable'
import { ExpiringDocuments } from '@/components/documents/ExpiringDocuments'
import { UploadDocumentDialog } from '@/components/documents/UploadDocumentDialog'
import type { EntityMaps } from '@/components/documents/document-display'


// Window (days) over which an upcoming expiry surfaces in the "Expiring documents" card.
const EXPIRY_WINDOW_DAYS = 90

export default async function DocumentsPage() {
  // Managers + accountant hold documents:read; accountant is read-only (no documents:write).
  const user = await requirePermission('documents:read')
  const canWrite = can(user.role, 'documents:write')
  const supabase = await createClient()

  const [documents, properties, units, tenancies, vendors, tickets] = await Promise.all([
    listDocuments(supabase, user.workspaceId),
    listProperties(supabase, user.workspaceId),
    listUnits(supabase, user.workspaceId),
    listTenancies(supabase, user.workspaceId),
    listVendors(supabase, user.workspaceId),
    listTickets(supabase, user.workspaceId),
  ])

  // Entity rosters → lookup maps the table/card read to resolve each document's attached
  // entity label without extra queries.
  const maps: EntityMaps = {
    properties: Object.fromEntries(properties.map((p) => [p.id, p.name])),
    units: Object.fromEntries(
      units.map((u) => [u.id, { label: u.label, propertyId: u.property_id }])
    ),
    tenancies: Object.fromEntries(
      tenancies.map((t) => [t.id, { tenantName: t.tenant_name, unitId: t.unit_id }])
    ),
    vendors: Object.fromEntries(vendors.map((v) => [v.id, v.company_name])),
    tickets: Object.fromEntries(tickets.map((t) => [t.id, t.title])),
  }

  // Documents expiring within the window (today .. +90d), soonest first. Past-due docs are
  // included too (they still need attention) — the card renders them with a red pill.
  const windowEnd = new Date()
  windowEnd.setHours(0, 0, 0, 0)
  windowEnd.setDate(windowEnd.getDate() + EXPIRY_WINDOW_DAYS)
  const expiring = documents
    .filter((d) => d.expires_at && new Date(d.expires_at) <= windowEnd)
    .sort((a, b) => (a.expires_at as string).localeCompare(b.expires_at as string))

  // Batch-sign download URLs (60s TTL, private bucket) — one storage-API call for
  // the whole page instead of one per document; a failed path just omits its link.
  const signedUrls = await signStoragePaths(supabase, DOCUMENTS_BUCKET, documents.map((d) => d.storage_path))
  const rows = documents.map((doc) => ({ doc, url: signedUrls.get(doc.storage_path) ?? null }))

  // Attach-to options for the upload dialog (write-only). Units carry their property name
  // for disambiguation; tenancies show the tenant name.
  const entityOptions = {
    properties: properties.map((p) => ({ id: p.id, label: p.name })),
    units: units.map((u) => ({
      id: u.id,
      label: maps.properties[u.property_id] ? `${maps.properties[u.property_id]} · ${u.label}` : u.label,
    })),
    tenancies: tenancies.map((t) => ({ id: t.id, label: t.tenant_name })),
    vendors: vendors.map((v) => ({ id: v.id, label: v.company_name })),
  }

  // The EDIT dialog additionally offers tickets: the upload UI never sets a ticket link,
  // but the schema/DB allow one, so editing must be able to restate it (replace
  // semantics would otherwise silently detach a ticket-attached document).
  const editEntityOptions = {
    ...entityOptions,
    tickets: tickets.map((t) => ({ id: t.id, label: t.title })),
  }
  const edit = canWrite ? { action: updateDocumentAction, entities: editEntityOptions } : undefined

  return (
    <div className="flex flex-col gap-6">
      <ErrorToast />

      <PageHeader
        title="Documents"
        subtitle="Leases, contracts, permits, certificates, and insurance — one repository, expiry tracked."
        actions={
          canWrite && (
            <UploadDocumentDialog action={uploadDocumentAction} entities={entityOptions} />
          )
        }
      />

      <ExpiringDocuments documents={expiring} maps={maps} />

      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="No documents yet"
          body="Upload a lease, permit, or certificate, and it will live here — attached to the right property, unit, or vendor, with its expiry tracked."
          action={
            canWrite ? (
              <UploadDocumentDialog action={uploadDocumentAction} entities={entityOptions} />
            ) : undefined
          }
        />
      ) : (
        <DocumentsTable rows={rows} maps={maps} edit={edit} />
      )}
    </div>
  )
}
