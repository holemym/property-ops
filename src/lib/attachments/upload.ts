import type { AttachmentType } from '@/types/domain'

// =============================================================================
// Attachment upload constraints + validation (P3.9).
//
// SERVER-SIDE enforcement of the file-upload limits. The HTML `accept=` attribute is a
// client hint ONLY (trivially bypassable); the REAL gate is this module, called from
// every upload action BEFORE any byte reaches Storage. Two constraints:
//   * MAX SIZE — reject files over MAX_FILE_SIZE_BYTES (10 MB). Server-action uploads
//     transit the Next server, so an unbounded size is a DoS/cost risk as well as a UX
//     one. (A signed-upload-URL approach that keeps large files off the server is a
//     Phase-4 optimization — see the action docstrings.)
//   * MIME ALLOWLIST — reject anything not in ALLOWED_MIME_TYPES. Photos (jpeg/png/webp)
//     and PDFs only; no executables, HTML, SVG (XSS vector), or arbitrary binaries.
// =============================================================================

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

// Allowlist, NOT a blocklist: only these MIME types may be stored. image/svg+xml is
// deliberately EXCLUDED — SVG can carry script and would be an XSS vector if ever served
// inline. application/pdf, and the three raster image types tenants photograph issues in.
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
}

// A human-friendly summary for error copy.
const ALLOWED_LABEL = 'JPEG, PNG, WebP, or PDF'
const MAX_LABEL = '10 MB'

export type FileValidationResult =
  | { ok: true; mime: string; size: number; type: AttachmentType }
  | { ok: false; error: string }

/**
 * Validate an uploaded File against the size + MIME constraints. Returns a discriminated
 * result the action turns into a friendly redirect error on failure. The `type` on
 * success is a coarse AttachmentType inferred from the MIME (PDF may be an invoice/report;
 * an image is a PHOTO) — callers can override, but this gives a sensible default without a
 * separate form field.
 *
 * NOTE: this validates the CLIENT-DECLARED file.type. Content-sniffing (magic bytes) is a
 * Phase-4 hardening; for the MVP the allowlist + size cap + the SVG exclusion + a private
 * bucket served only via signed URLs is the accepted posture, documented here.
 */
export function validateUploadFile(file: File): FileValidationResult {
  if (!file || file.size === 0) {
    return { ok: false, error: 'Please choose a file to upload.' }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `File is too large. The maximum size is ${MAX_LABEL}.` }
  }
  const mime = file.type
  if (!isAllowedMimeType(mime)) {
    return { ok: false, error: `Unsupported file type. Allowed types: ${ALLOWED_LABEL}.` }
  }
  return { ok: true, mime, size: file.size, type: inferAttachmentType(mime) }
}

/** Coarse default AttachmentType from a validated MIME. Images → PHOTO; PDF → OTHER. */
export function inferAttachmentType(mime: string): AttachmentType {
  if (mime.startsWith('image/')) return 'PHOTO'
  return 'OTHER'
}
