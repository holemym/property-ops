import { z } from 'zod'
import type { DocumentType } from '@/types/domain'

// =============================================================================
// Document upload constraints + form validation (P?.? documents hub, 0018).
//
// Two layers, both server-enforced:
//   * FILE constraints — MAX size + a MIME ALLOWLIST (mirrors the attachments module in
//     src/lib/attachments/upload.ts). The bytes transit the Next server, so an unbounded
//     size is a DoS/cost risk; the allowlist keeps executables/HTML/SVG (XSS) out. Note
//     documents also accept a broader OFFICE-doc set (leases/contracts are often .docx)
//     on top of the image/PDF set.
//   * FORM shape — title required, a DocumentType enum, an optional ISO date expiry,
//     optional notes, and the five optional entity refs (each a uuid). The HTML form is a
//     hint only; this schema is the real gate the action runs before any byte is stored.
// =============================================================================

export const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

// Allowlist, NOT a blocklist. image/svg+xml is deliberately EXCLUDED (SVG can carry
// script → XSS if ever served inline). Photos + PDF (as attachments) PLUS the common
// office document types a lease/contract/certificate is typically supplied in.
export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
] as const

export type AllowedDocumentMimeType = (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number]

export function isAllowedDocumentMimeType(mime: string): mime is AllowedDocumentMimeType {
  return (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime)
}

// Human-friendly summaries for error copy (sentence case).
export const ALLOWED_DOCUMENT_LABEL = 'JPEG, PNG, WebP, PDF, or Word document'
export const MAX_DOCUMENT_LABEL = '10 MB'

// The DocumentType enum, kept in lock-step with '@/types/domain'. The `satisfies` check
// makes the compiler flag any drift between this literal tuple and the domain union.
const DOCUMENT_TYPES = [
  'LEASE',
  'CONTRACT',
  'PERMIT',
  'CERTIFICATE',
  'INSURANCE',
  'ID',
  'INVOICE',
  'OTHER',
] as const satisfies readonly DocumentType[]

// Calendar-date shape (HTML <input type="date"> + Postgres `date`). We validate the shape
// with a regex rather than z.coerce.date() so the value stays a plain date string
// end-to-end (no timezone shifting from a Date round-trip) — but the regex alone let
// impossible dates (2026-13-40) through to Postgres, which rejected them with a raw
// `date/time field value out of range` error. The refine builds a UTC Date (no local-TZ
// drift) and round-trips it: JS Date normalizes overflow (Feb 30 -> Mar 2), so any
// component changing means the date never existed. Optional/nullable = no expiry.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry must be in YYYY-MM-DD format')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    )
  }, 'Expiry must be a real calendar date')

const optionalUuid = z.string().uuid('Invalid reference').nullable().optional()

export const documentFormSchema = z.object({
  title: z.string().min(1, 'A title is required').max(200),
  documentType: z.enum(DOCUMENT_TYPES),
  // `|| null` in the action maps "" to null before this runs; when present it must be a
  // well-formed date. `.nullable().optional()` lets an omitted/null expiry through.
  expiresAt: isoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  // The five entity refs — at most one is set (or none). Each is an optional uuid; the
  // "exactly one" rule is intentionally NOT enforced here (a document may hang off nothing
  // or off one entity), and the composite FK is the workspace-integrity backstop.
  propertyId: optionalUuid,
  unitId: optionalUuid,
  tenancyId: optionalUuid,
  vendorId: optionalUuid,
  ticketId: optionalUuid,
})

export type DocumentFormValues = z.infer<typeof documentFormSchema>

// The metadata-edit subset (updateDocumentAction): everything about the row EXCEPT the
// stored bytes (no file — storage rows are append-only by design) and document_type
// (not editable; re-uploading under the right type is rarer than a mis-attachment and
// out of this dialog's scope). Derived from the upload schema so the two can never
// drift on shared fields.
export const documentUpdateSchema = documentFormSchema.omit({ documentType: true })

export type DocumentUpdateValues = z.infer<typeof documentUpdateSchema>
