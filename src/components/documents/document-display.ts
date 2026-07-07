import type { DocumentType } from '@/types/domain'

// Shared display helpers for the documents surface — a single source of truth for the
// document_type badge tone/label, file-size rounding, and the attached-entity label.
// Imported by both the table and the expiring-documents card so tones stay consistent.

// Badge variant per document_type. Tones map 1:1 to the Badge variants
// (neutral/muted/blue/amber/green/red) — reused, not saturated, so status color stays
// reserved for real status. Kept tasteful: leases/contracts blue, safety docs green,
// insurance amber, identity/invoice neutral, other muted.
type DocTone = 'blue' | 'green' | 'amber' | 'neutral' | 'muted'

const TYPE_TONE: Record<DocumentType, DocTone> = {
  LEASE: 'blue',
  CONTRACT: 'blue',
  PERMIT: 'green',
  CERTIFICATE: 'green',
  INSURANCE: 'amber',
  ID: 'neutral',
  INVOICE: 'neutral',
  OTHER: 'muted',
}

export function documentTypeTone(type: DocumentType): DocTone {
  return TYPE_TONE[type] ?? 'muted'
}

// Title-case a SCREAMING_SNAKE enum for display, e.g. LEASE -> "Lease".
export function documentTypeLabel(type: DocumentType): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Round a byte count to a friendly unit. Whole KB, one-decimal MB — no long decimals.
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Lookup maps a document resolves its attached-entity label against. The page builds these
// once from the workspace rosters; the label functions read them without extra queries.
export type EntityMaps = {
  properties: Record<string, string> // id -> property name
  units: Record<string, { label: string; propertyId: string }>
  tenancies: Record<string, { tenantName: string; unitId: string }>
  vendors: Record<string, string> // id -> company name
  tickets: Record<string, string> // id -> ticket title
}

export type EntityLabel = { kind: string; name: string } | null

// Resolve a document's single attached entity (at most one link is set) to a
// { kind, name } pair for display, e.g. "Unit · Top 1". Returns null when the document is
// workspace-level (no link) or the linked row is missing from the rosters, so the caller
// renders an em dash.
export function attachedEntityLabel(
  doc: {
    property_id: string | null
    unit_id: string | null
    tenancy_id: string | null
    vendor_id: string | null
    ticket_id: string | null
  },
  maps: EntityMaps
): EntityLabel {
  if (doc.unit_id) {
    const unit = maps.units[doc.unit_id]
    if (unit) return { kind: 'Unit', name: unit.label }
  }
  if (doc.tenancy_id) {
    const tenancy = maps.tenancies[doc.tenancy_id]
    if (tenancy) return { kind: 'Tenancy', name: tenancy.tenantName }
  }
  if (doc.property_id) {
    const name = maps.properties[doc.property_id]
    if (name) return { kind: 'Property', name }
  }
  if (doc.vendor_id) {
    const name = maps.vendors[doc.vendor_id]
    if (name) return { kind: 'Vendor', name }
  }
  if (doc.ticket_id) {
    const name = maps.tickets[doc.ticket_id]
    if (name) return { kind: 'Ticket', name }
  }
  return null
}
