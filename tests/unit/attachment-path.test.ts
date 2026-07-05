import { describe, it, expect } from 'vitest'
import { sanitizeFileName, buildStoragePath } from '@/lib/data/attachments'
import {
  validateUploadFile,
  isAllowedMimeType,
  inferAttachmentType,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/attachments/upload'

const WS = 'workspace-a'
const TICKET = 'ticket-b'

// ---------------------------------------------------------------------------
// sanitizeFileName — the client-influenced part of a storage key. These lock the
// path-traversal defenses: NO character it emits may be a path separator.
// ---------------------------------------------------------------------------
describe('sanitizeFileName', () => {
  it('strips path separators from a traversal filename (no "/" survives)', () => {
    const out = sanitizeFileName('../../etc/passwd')
    expect(out).not.toContain('/')
    expect(out).not.toContain('\\')
    // '/' → '_', dots kept, then the leading dot-run is stripped
    expect(out).toBe('_.._etc_passwd')
  })

  it('replaces every char outside [A-Za-z0-9._-] with "_"', () => {
    expect(sanitizeFileName('a b/c\\d:e*f?.png')).toBe('a_b_c_d_e_f_.png')
  })

  it('backslash separators cannot survive', () => {
    expect(sanitizeFileName('..\\..\\windows\\system32')).not.toContain('\\')
  })

  it('empty / dot-only input falls back to "file"', () => {
    // Empty stays empty → 'file'. A dot-only name has its whole leading dot-run
    // stripped, leaving empty → 'file'.
    expect(sanitizeFileName('')).toBe('file')
    expect(sanitizeFileName('....')).toBe('file')
  })

  it('strips leading dots', () => {
    expect(sanitizeFileName('...hidden.png')).toBe('hidden.png')
  })

  it('length-caps very long names', () => {
    const out = sanitizeFileName('a'.repeat(500) + '.png')
    expect(out.length).toBeLessThanOrEqual(120)
  })
})

// ---------------------------------------------------------------------------
// buildStoragePath — the server-built key. First segment MUST be the workspace,
// second the ticket, third a single sanitized basename. A traversal filename
// must NOT be able to introduce an extra "/" segment.
// ---------------------------------------------------------------------------
describe('buildStoragePath', () => {
  it('starts with `${workspaceId}/${ticketId}/`', () => {
    const path = buildStoragePath(WS, TICKET, 'photo.png')
    expect(path.startsWith(`${WS}/${TICKET}/`)).toBe(true)
  })

  it('yields exactly 3 segments even for a traversal filename', () => {
    const path = buildStoragePath(WS, TICKET, '../../etc/passwd')
    const segments = path.split('/')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toBe(WS)
    expect(segments[1]).toBe(TICKET)
    expect(segments[2]).not.toContain('/')
  })

  it('basename is uuid-prefixed and contains the sanitized name', () => {
    const path = buildStoragePath(WS, TICKET, 'my file.png')
    const basename = path.split('/')[2]
    expect(basename).toMatch(/^[0-9a-f-]{36}-my_file\.png$/)
  })

  it('two builds for the same filename differ (uuid uniqueness)', () => {
    const a = buildStoragePath(WS, TICKET, 'x.png')
    const b = buildStoragePath(WS, TICKET, 'x.png')
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// validateUploadFile — server-side size + MIME allowlist.
// ---------------------------------------------------------------------------
describe('validateUploadFile', () => {
  it('accepts an allowed image under the size cap', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const result = validateUploadFile(file)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.mime).toBe('image/png')
      expect(result.type).toBe('PHOTO')
    }
  })

  it('accepts a PDF and infers OTHER', () => {
    const file = new File(['x'], 'invoice.pdf', { type: 'application/pdf' })
    const result = validateUploadFile(file)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.type).toBe('OTHER')
  })

  it('rejects an empty file', () => {
    const file = new File([], 'empty.png', { type: 'image/png' })
    expect(validateUploadFile(file).ok).toBe(false)
  })

  it('rejects a disallowed MIME (svg — XSS vector)', () => {
    const file = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })
    expect(validateUploadFile(file).ok).toBe(false)
  })

  it('rejects HTML and executables', () => {
    expect(validateUploadFile(new File(['x'], 'x.html', { type: 'text/html' })).ok).toBe(false)
    expect(
      validateUploadFile(new File(['x'], 'x.exe', { type: 'application/x-msdownload' })).ok
    ).toBe(false)
  })

  it('rejects an oversize file', () => {
    // Constructing a real >10MB File in node is wasteful; stub .size on a valid-typed
    // object cast to File. validateUploadFile reads only .size/.type.
    const fake = { size: MAX_FILE_SIZE_BYTES + 1, type: 'image/png', name: 'big.png' } as File
    expect(validateUploadFile(fake).ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAllowedMimeType / inferAttachmentType
// ---------------------------------------------------------------------------
describe('mime helpers', () => {
  it('isAllowedMimeType allows the four types and nothing else', () => {
    expect(isAllowedMimeType('image/jpeg')).toBe(true)
    expect(isAllowedMimeType('application/pdf')).toBe(true)
    expect(isAllowedMimeType('image/svg+xml')).toBe(false)
    expect(isAllowedMimeType('text/html')).toBe(false)
  })

  it('inferAttachmentType maps image → PHOTO, pdf → OTHER', () => {
    expect(inferAttachmentType('image/webp')).toBe('PHOTO')
    expect(inferAttachmentType('application/pdf')).toBe('OTHER')
  })
})
