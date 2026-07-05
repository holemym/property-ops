'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireWorkspace } from '@/lib/auth/session'
import { can, isTenantRole } from '@/lib/auth/permissions'
import { redirectWithError } from '@/lib/redirect-with-error'
import { getTicket } from '@/lib/data/tickets'
import { appendTicketEvent } from '@/lib/data/ticket-events'
import {
  ATTACHMENTS_BUCKET,
  buildStoragePath,
  createAttachmentRecord,
} from '@/lib/data/attachments'
import { validateUploadFile } from '@/lib/attachments/upload'

// =============================================================================
// Attachment upload action (P3.9) — shared by the MANAGER ticket detail page and the
// TENANT portal detail page. ONE action, two authorization shapes:
//   * MANAGER (tickets:write): may attach to any ticket in their workspace.
//   * TENANT (isTenantRole): may attach ONLY to a ticket they OWN — enforced by
//     getTicket returning non-null under RLS (tickets_select_own matches created_by OR
//     created_for), i.e. the same own-ticket gate the portal read uses.
//
// UPLOAD APPROACH — SERVER-ACTION multipart (decision, documented):
//   The File arrives as multipart FormData to this server action. We validate size +
//   MIME server-side (validateUploadFile — the HTML accept= attr is a hint only), build
//   a SAFE storage key from the VALIDATED workspace_id/ticket_id (buildStoragePath; the
//   client never chooses the workspace/ticket path segments), upload via the AUTHENTICATED
//   client so Storage RLS (0015) re-checks workspace+ticket access, then insert the
//   metadata row (also RLS-checked) and log a best-effort ATTACHMENT_UPLOADED event.
//   TRADEOFF: the bytes transit the Next server (capped at 10 MB). A createSignedUploadUrl
//   flow that PUTs directly to Storage is a Phase-4 optimization for large files.
// =============================================================================

const ATTACHMENT_REDIRECT = {
  manager: (id: string) => `/tickets/${id}`,
  tenant: (id: string) => `/portal/${id}`,
} as const

/**
 * Upload an attachment to a ticket. `surface` decides the authorization + redirect target
 * so the same action backs both the operator detail page and the tenant portal.
 */
export async function uploadAttachmentAction(
  ticketId: string,
  surface: 'manager' | 'tenant',
  formData: FormData
) {
  const user = await requireWorkspace()
  const detailPath = ATTACHMENT_REDIRECT[surface](ticketId)

  // Authorization by surface. The REAL enforcement is RLS (Storage + table) + the
  // getTicket own-row read below; these app-layer gates give clean errors and keep each
  // surface to its intended role.
  if (surface === 'manager') {
    if (!can(user.role, 'tickets:write')) {
      redirectWithError(detailPath, 'You do not have permission to upload here.')
    }
  } else {
    if (!isTenantRole(user.role)) {
      redirectWithError('/portal', 'Not available for your role.')
    }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    redirectWithError(detailPath, 'Please choose a file to upload.')
  }
  const validation = validateUploadFile(file)
  if (!validation.ok) {
    redirectWithError(detailPath, validation.error)
  }

  const supabase = await createClient()

  // Confirm the ticket is visible to THIS caller under RLS. For a tenant this is the
  // own-ticket gate (tickets_select_own → created_by OR created_for); for a manager it
  // confirms the ticket is in their workspace. A null return means "not yours / not here"
  // → reject, so a tenant cannot upload to another tenant's ticket even by guessing its id.
  const ticket = await getTicket(supabase, user.workspaceId, ticketId)
  if (!ticket) {
    redirectWithError(detailPath, 'Ticket not found.')
  }

  // SERVER-BUILT path from the VALIDATED workspace_id + ticket_id (never client input).
  // Filename sanitized inside buildStoragePath.
  const storagePath = buildStoragePath(user.workspaceId, ticketId, file.name)

  // Upload via the AUTHENTICATED client → Storage RLS (0015) re-validates that this
  // caller may write under `${workspaceId}/${ticketId}/...` (first segment = own
  // workspace; manager OR owns the ticket; active). Defense-in-depth over the app gates.
  try {
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: validation.mime,
        upsert: false,
      })
    if (uploadError) throw uploadError
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not upload the file.')
  }

  // Metadata row via the AUTHENTICATED client → attachments table RLS re-checks
  // workspace + ownership + authorship (uploaded_by = auth.uid()). If this fails we leave
  // the object in place (an orphan the Phase-4 cleanup addresses) but surface the error.
  try {
    await createAttachmentRecord(supabase, {
      workspaceId: user.workspaceId,
      ticketId,
      uploadedByUserId: user.id,
      fileName: file.name,
      storagePath,
      fileType: validation.mime,
      fileSize: validation.size,
      attachmentType: validation.type,
    })
  } catch (e) {
    redirectWithError(detailPath, e instanceof Error ? e.message : 'Could not save the attachment.')
  }

  // Best-effort audit event via the SERVICE-ROLE client (only principal allowed to call
  // log_ticket_event). Mirrors the P3.6/P3.7 discipline: never fails the action.
  try {
    await appendTicketEvent(createServiceClient(), {
      workspaceId: user.workspaceId,
      ticketId,
      eventType: 'ATTACHMENT_UPLOADED',
      actorUserId: user.id,
      actorType: 'USER',
      metadataJson: { fileName: file.name, fileType: validation.mime, fileSize: validation.size },
    })
  } catch (e) {
    console.error('Failed to log ATTACHMENT_UPLOADED event for ticket', ticketId, e)
  }

  revalidatePath(detailPath)
  redirect(detailPath)
}
