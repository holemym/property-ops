import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Document, DocumentType } from '@/types/domain'

// =============================================================================
// Documents hub — the data layer behind the general documents repository (0018).
//
// SPLIT OF RESPONSIBILITY (mirrors attachments 0015):
//   * The BYTES live in the PRIVATE Supabase Storage bucket 'documents'. Objects are
//     keyed `workspace_id/<uuid>-<sanitized-filename>` (buildDocumentStoragePath) and
//     gated by storage.objects RLS (0018) that keys off the path's FIRST (workspace)
//     segment only — documents are role-gated (manager/accountant), NOT owner-scoped, so
//     there is no per-entity second segment like attachments carry.
//   * The METADATA lives in public.documents (one row per object) and is gated by table
//     RLS: SELECT for managers + accountant, INSERT/UPDATE for managers only.
//
// This module owns: the pure, security-critical PATH BUILDER + FILENAME SANITIZER
// (unit-tested hard against path-traversal), and thin RLS-bound wrappers to list + insert
// metadata rows. It does NOT do the byte upload / URL signing — those live in the server
// actions, which use the authenticated (RLS-scoped) client so Storage RLS applies.
// =============================================================================

export const DOCUMENTS_BUCKET = 'documents'

// -----------------------------------------------------------------------------
// SECURITY-CRITICAL pure helpers: sanitizeFileName + buildDocumentStoragePath.
//
// The storage key is ALWAYS server-built from a VALIDATED workspace_id (the caller's own,
// from the session). The client NEVER supplies the workspace segment. The only
// client-influenced part is the original filename, and sanitizeFileName neutralizes it:
// everything outside [A-Za-z0-9._-] (in particular '/', '\', and the '.' runs that form
// '..') is replaced with '_', so the sanitized name can contain NO path separator and
// cannot introduce an extra path segment. Combined with the fixed `${workspaceId}/` prefix
// and a random uuid, the resulting key's FIRST segment is always the workspace_id — which
// is exactly what the Storage RLS policies key on.
// -----------------------------------------------------------------------------

/**
 * Strip a filename down to a path-safe token: replace every character NOT in
 * [A-Za-z0-9._-] with '_'. This removes path separators ('/', '\'), turns traversal
 * sequences like `../` into `.._`, and (via the leading-dot strip) prevents a
 * hidden/dotfile-looking basename. An empty / all-unsafe result falls back to 'file' so
 * the basename is never empty. Length-capped to keep keys sane. (Copied verbatim from the
 * attachments sanitizer — the same hardening applies.)
 */
export function sanitizeFileName(fileName: string): string {
  const cleaned = (fileName ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
  const trimmed = cleaned.slice(0, 120)
  return trimmed.length > 0 ? trimmed : 'file'
}

/**
 * Build the storage object key for a document:
 *   `${workspaceId}/${uuid}-${sanitize(fileName)}`
 * workspaceId is SERVER-VALIDATED (never a client-chosen segment); fileName is sanitized.
 * The uuid prefix guarantees uniqueness even for identical filenames. The returned key's
 * first segment is workspaceId — the invariant the Storage RLS policies (0018) depend on.
 */
export function buildDocumentStoragePath(workspaceId: string, fileName: string): string {
  return `${workspaceId}/${randomUUID()}-${sanitizeFileName(fileName)}`
}

// -----------------------------------------------------------------------------
// RLS-bound wrappers (authenticated client).
// -----------------------------------------------------------------------------

/**
 * List a workspace's documents. RLS (0018) scopes WHICH rows come back per role: managers
 * + accountant see all of the workspace's documents; tenant/guest/vendor see none. Scoped
 * by workspace_id at the query layer, newest-first.
 */
export async function listDocuments(
  supabase: SupabaseClient,
  workspaceId: string,
  filters: { propertyId?: string } = {}
): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select('*')
    .eq('workspace_id', workspaceId)
  // Optional direct-attribution scope (property hub). The unit hub keeps the
  // unfiltered list on purpose: its scope is unit_id OR tenancy-of-unit, an OR
  // the page computes in JS.
  if (filters.propertyId) query = query.eq('property_id', filters.propertyId)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Document[]
}

export type CreateDocumentInput = {
  workspaceId: string
  // NULL when there is no authenticated uploader; the auth'd path passes the caller's id.
  uploadedByUserId: string | null
  documentType: DocumentType
  title: string
  storagePath: string
  fileType: string
  fileSize: number
  expiresAt?: string | null
  // At most ONE of these entity refs is set (or none — a workspace-level document). Each
  // is a NULLABLE composite FK to (id, workspace_id) of its parent, so a non-NULL ref is
  // un-bypassably pinned to this document's workspace (the DB backstop).
  propertyId?: string | null
  unitId?: string | null
  tenancyId?: string | null
  vendorId?: string | null
  ticketId?: string | null
  notes?: string | null
}

/**
 * Insert the metadata row for an already-uploaded object. Called AFTER the bytes land in
 * Storage, via the authenticated (RLS-bound) client so documents_insert_manager enforces
 * workspace + manager role. Undefined entity refs default to NULL (document unattached).
 */
export async function createDocument(
  supabase: SupabaseClient,
  input: CreateDocumentInput
): Promise<Document> {
  const { data, error } = await supabase
    .from('documents')
    .insert({
      workspace_id: input.workspaceId,
      uploaded_by_user_id: input.uploadedByUserId,
      document_type: input.documentType,
      title: input.title,
      storage_path: input.storagePath,
      file_type: input.fileType,
      file_size: input.fileSize,
      expires_at: input.expiresAt ?? null,
      property_id: input.propertyId ?? null,
      unit_id: input.unitId ?? null,
      tenancy_id: input.tenancyId ?? null,
      vendor_id: input.vendorId ?? null,
      ticket_id: input.ticketId ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Document
}
