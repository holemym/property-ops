import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentType } from '@/types/domain'

// =============================================================================
// Ticket attachments — the data layer behind file uploads on tickets (P3.9).
//
// SPLIT OF RESPONSIBILITY:
//   * The BYTES live in the PRIVATE Supabase Storage bucket 'attachments'. Objects are
//     keyed `workspace_id/ticket_id/<uuid>-<sanitized-filename>` (buildStoragePath) and
//     gated by storage.objects RLS (migration 0015) that keys on the path's first
//     (workspace) and second (ticket) segments.
//   * The METADATA lives in public.attachments (one row per object) and is gated by
//     table RLS mirroring ticket visibility.
//
// This module owns: the pure, security-critical PATH BUILDER + FILENAME SANITIZER
// (unit-tested hard against path-traversal), and thin RLS-bound wrappers to list +
// insert metadata rows. It does NOT do the byte upload / URL signing — those live in
// the server actions, which pick the right client (authenticated for manager/tenant so
// Storage RLS applies; service-role for vendor token uploads).
// =============================================================================

export const ATTACHMENTS_BUCKET = 'attachments'

export type Attachment = {
  id: string
  workspace_id: string
  ticket_id: string
  uploaded_by_user_id: string | null
  file_name: string
  storage_path: string
  file_type: string
  file_size: number
  attachment_type: AttachmentType
  created_at: string
}

// -----------------------------------------------------------------------------
// SECURITY-CRITICAL pure helpers: sanitizeFileName + buildStoragePath.
//
// The storage key is ALWAYS server-built from a VALIDATED workspace_id + ticket_id (the
// caller's own workspace, from the session; the ticket confirmed accessible). The client
// NEVER supplies the workspace/ticket segments. The only client-influenced part is the
// original filename, and sanitizeFileName neutralizes it: everything outside
// [A-Za-z0-9._-] (in particular '/', '\', and the '.' runs that form '..') is replaced
// with '_', so the sanitized name can contain NO path separator and cannot introduce an
// extra path segment. Combined with the fixed `${workspaceId}/${ticketId}/` prefix and a
// random uuid, the resulting key's FIRST segment is always the workspace_id and its
// SECOND is always the ticket_id — which is exactly what the Storage RLS policies key on.
// -----------------------------------------------------------------------------

/**
 * Strip a filename down to a path-safe token: replace every character NOT in
 * [A-Za-z0-9._-] with '_'. This removes path separators ('/', '\'), collapses nothing
 * (each unsafe char → one '_', preserving length so distinct names stay distinct), and
 * turns traversal sequences like `../` into `.._`. An empty / all-unsafe result falls
 * back to 'file' so the basename is never empty. Length-capped to keep keys sane.
 */
export function sanitizeFileName(fileName: string): string {
  const cleaned = (fileName ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // Guard against a leading '.' producing a hidden/dotfile-looking basename and against
    // a bare '..' slipping through as a segment name — neither can be a path separator
    // after the replace above, but normalize a leading run of dots to be safe.
    .replace(/^\.+/, '')
  const trimmed = cleaned.slice(0, 120)
  return trimmed.length > 0 ? trimmed : 'file'
}

/**
 * Build the storage object key for an attachment:
 *   `${workspaceId}/${ticketId}/${uuid}-${sanitize(fileName)}`
 * workspaceId + ticketId are SERVER-VALIDATED (never client-chosen segments); fileName
 * is sanitized. The uuid prefix guarantees uniqueness even for identical filenames on the
 * same ticket. The returned key's first segment is workspaceId and second is ticketId —
 * the invariant the Storage RLS policies (0015) depend on.
 */
export function buildStoragePath(
  workspaceId: string,
  ticketId: string,
  fileName: string
): string {
  return `${workspaceId}/${ticketId}/${randomUUID()}-${sanitizeFileName(fileName)}`
}

// -----------------------------------------------------------------------------
// RLS-bound wrappers (authenticated client) — thin, double-scoped.
// -----------------------------------------------------------------------------

/**
 * List a ticket's attachments. RLS (0015) scopes WHICH rows come back per role
 * (managers/accountant see all workspace attachments; a tenant sees only attachments on
 * a ticket they own). Double-scoped by workspace_id + ticket_id at the query layer so a
 * caller can never widen past the single ticket, ordered oldest-first.
 */
export async function listAttachments(
  supabase: SupabaseClient,
  workspaceId: string,
  ticketId: string
): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('attachments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as Attachment[]
}

export type CreateAttachmentRecordInput = {
  workspaceId: string
  ticketId: string
  // NULL for vendor uploads (no profile / auth.uid()); the auth'd upload paths pass the
  // uploader's id (RLS pins uploaded_by_user_id = auth.uid() for the tenant policy).
  uploadedByUserId: string | null
  fileName: string
  storagePath: string
  fileType: string
  fileSize: number
  attachmentType: AttachmentType
}

/**
 * Insert the metadata row for an already-uploaded object. Called AFTER the bytes land in
 * Storage. For manager/tenant uploads the caller passes the authenticated (RLS-bound)
 * client so attachments_insert_* enforces workspace + ownership + authorship; for vendor
 * token uploads the caller passes the SERVICE-ROLE client (bypasses RLS, uploaded_by NULL).
 */
export async function createAttachmentRecord(
  supabase: SupabaseClient,
  input: CreateAttachmentRecordInput
): Promise<Attachment> {
  const { data, error } = await supabase
    .from('attachments')
    .insert({
      workspace_id: input.workspaceId,
      ticket_id: input.ticketId,
      uploaded_by_user_id: input.uploadedByUserId,
      file_name: input.fileName,
      storage_path: input.storagePath,
      file_type: input.fileType,
      file_size: input.fileSize,
      attachment_type: input.attachmentType,
    })
    .select()
    .single()
  if (error) throw error
  return data as Attachment
}
