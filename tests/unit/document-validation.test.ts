import { describe, it, expect } from 'vitest'
import {
  documentFormSchema,
  documentUpdateSchema,
  ALLOWED_DOCUMENT_MIME_TYPES,
  isAllowedDocumentMimeType,
} from '@/lib/validation/document'

const VALID_UPLOAD = {
  title: 'Lease — Top 1',
  documentType: 'LEASE',
  expiresAt: null,
  notes: null,
  propertyId: null,
  unitId: null,
  tenancyId: null,
  vendorId: null,
  ticketId: null,
}

describe('documentFormSchema expiry date', () => {
  it('accepts a real date and no expiry', () => {
    expect(documentFormSchema.safeParse({ ...VALID_UPLOAD, expiresAt: '2026-09-01' }).success).toBe(true)
    expect(documentFormSchema.safeParse(VALID_UPLOAD).success).toBe(true)
  })

  it('accepts a leap-year Feb 29', () => {
    expect(documentFormSchema.safeParse({ ...VALID_UPLOAD, expiresAt: '2024-02-29' }).success).toBe(true)
  })

  it('rejects impossible dates that match the shape regex (the raw-Postgres-error gap)', () => {
    for (const impossible of ['2026-13-40', '2026-02-30', '2025-02-29', '2026-00-10', '2026-06-00']) {
      const result = documentFormSchema.safeParse({ ...VALID_UPLOAD, expiresAt: impossible })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Expiry must be a real calendar date')
      }
    }
  })

  it('still rejects a malformed shape with the format message', () => {
    const result = documentFormSchema.safeParse({ ...VALID_UPLOAD, expiresAt: 'next tuesday' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Expiry must be in YYYY-MM-DD format')
    }
  })
})

describe('documentUpdateSchema (metadata edit)', () => {
  it('is the upload schema minus documentType', () => {
    const result = documentUpdateSchema.safeParse({
      title: 'Renamed lease',
      expiresAt: '2027-01-31',
      notes: 'moved from the wrong unit',
      propertyId: null,
      unitId: null,
      tenancyId: '4c9f2c1e-8b7a-4f3d-9e2a-1b2c3d4e5f60',
      vendorId: null,
      ticketId: null,
    })
    expect(result.success).toBe(true)
    // documentType is neither required nor accepted as a known key.
    expect('documentType' in documentUpdateSchema.shape).toBe(false)
  })

  it('shares the real-date expiry refine with the upload schema', () => {
    const result = documentUpdateSchema.safeParse({ title: 'x', expiresAt: '2026-02-30' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Expiry must be a real calendar date')
    }
  })

  it('rejects a non-uuid entity ref', () => {
    expect(documentUpdateSchema.safeParse({ title: 'x', unitId: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('allowed MIME types (file-picker accept= lock-step)', () => {
  it('includes the Word types the server explicitly allows', () => {
    // The UploadDocumentDialog accept= is built from this exact const; these two are the
    // types the old hardcoded accept string silently dropped.
    expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain('application/msword')
    expect(ALLOWED_DOCUMENT_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(isAllowedDocumentMimeType('application/msword')).toBe(true)
  })

  it('still excludes SVG (XSS) and arbitrary types', () => {
    expect(isAllowedDocumentMimeType('image/svg+xml')).toBe(false)
    expect(isAllowedDocumentMimeType('text/html')).toBe(false)
  })
})
