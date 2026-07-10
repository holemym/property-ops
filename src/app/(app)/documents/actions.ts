'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { isDemoWorkspace, DEMO_UPLOAD_BLOCKED_MESSAGE } from '@/lib/demo'
import {
  DOCUMENTS_BUCKET,
  buildDocumentStoragePath,
  createDocument,
} from '@/lib/data/documents'
import {
  documentFormSchema,
  isAllowedDocumentMimeType,
  MAX_DOCUMENT_SIZE_BYTES,
  ALLOWED_DOCUMENT_LABEL,
  MAX_DOCUMENT_LABEL,
} from '@/lib/validation/document'
import { getProperty } from '@/lib/data/properties'
import { getUnit } from '@/lib/data/units'
import { getVendor } from '@/lib/data/vendors'
import { getTicket } from '@/lib/data/tickets'

// =============================================================================
// Document upload action (0018 documents hub) — the MANAGER surface only.
//
// AUTHORIZATION: requirePermission('documents:write') gates OWNER/OPERATOR/SUPER_ADMIN;
// ACCOUNTANT is read-only here (holds documents:read, not documents:write) — the inverse
// of finance. RLS (documents table + storage.objects, both is_workspace_manager()-gated)
// is the un-bypassable boundary; this app gate just gives a clean error.
//
// UPLOAD APPROACH — SERVER-ACTION multipart (mirrors uploadAttachmentAction):
//   The File arrives as multipart FormData. We validate size + MIME server-side (the HTML
//   accept= is a hint only), build a SAFE storage key from the VALIDATED workspace_id
//   (buildDocumentStoragePath — the client never chooses the workspace path segment),
//   upload via the AUTHENTICATED client so Storage RLS (0018) re-checks workspace + manager
//   access, then insert the metadata row (also RLS-checked, uploaded_by = caller).
//   TRADEOFF: the bytes transit the Next server (capped at 10 MB). A createSignedUploadUrl
//   flow is a Phase-4 optimization for large files.
// =============================================================================

const DOCUMENTS_PATH = '/documents'

/**
 * Upload a document to the workspace repository. Reads the File + form fields from
 * FormData, validates them, uploads the bytes to the private 'documents' bucket, then
 * writes the metadata row. Any failure redirects to /documents?error=... . On success it
 * revalidates and returns (the UI form redirects/refreshes).
 */
export async function uploadDocumentAction(formData: FormData): Promise<void> {
  const user = await requirePermission('documents:write')

  // D4 in-demo gate: uploads are blocked for the shared demo workspace (spec §4) — real
  // file bytes hitting Storage would survive the daily reset's DB-only scope.
  if (isDemoWorkspace(user.workspaceId)) {
    redirectWithError(DOCUMENTS_PATH, DEMO_UPLOAD_BLOCKED_MESSAGE)
  }

  // --- File presence + size/MIME validation (server-side; the HTML accept= is a hint). ---
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    redirectWithError(DOCUMENTS_PATH, 'Please choose a file to upload.')
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    redirectWithError(DOCUMENTS_PATH, `File is too large. The maximum size is ${MAX_DOCUMENT_LABEL}.`)
  }
  const mime = file.type
  if (!isAllowedDocumentMimeType(mime)) {
    redirectWithError(DOCUMENTS_PATH, `Unsupported file type. Allowed types: ${ALLOWED_DOCUMENT_LABEL}.`)
  }

  // --- Form-field validation. `|| null` maps empty strings to null before zod runs. ---
  const parsed = documentFormSchema.safeParse({
    title: formData.get('title'),
    documentType: formData.get('documentType'),
    expiresAt: (formData.get('expiresAt') as string | null) || null,
    notes: (formData.get('notes') as string | null) || null,
    propertyId: (formData.get('propertyId') as string | null) || null,
    unitId: (formData.get('unitId') as string | null) || null,
    tenancyId: (formData.get('tenancyId') as string | null) || null,
    vendorId: (formData.get('vendorId') as string | null) || null,
    ticketId: (formData.get('ticketId') as string | null) || null,
  })
  if (!parsed.success) {
    redirectWithError(DOCUMENTS_PATH, parsed.error.issues[0].message)
  }
  const form = parsed.data

  const supabase = await createClient()

  // --- Friendly ownership check for a provided entity ref. The DB composite FK (each
  // (entity_id, workspace_id) -> parent(id, workspace_id)) is the un-bypassable backstop;
  // this workspace-scoped read just turns a cross-workspace / missing ref into readable
  // copy instead of a raw FK-violation error. At most one ref is expected to be set. ---
  if (form.propertyId) {
    const property = await getProperty(supabase, user.workspaceId, form.propertyId)
    if (!property) redirectWithError(DOCUMENTS_PATH, 'Selected property was not found in your workspace.')
  }
  if (form.unitId) {
    const unit = await getUnit(supabase, user.workspaceId, form.unitId)
    if (!unit) redirectWithError(DOCUMENTS_PATH, 'Selected unit was not found in your workspace.')
  }
  if (form.vendorId) {
    const vendor = await getVendor(supabase, user.workspaceId, form.vendorId)
    if (!vendor) redirectWithError(DOCUMENTS_PATH, 'Selected vendor was not found in your workspace.')
  }
  if (form.ticketId) {
    const ticket = await getTicket(supabase, user.workspaceId, form.ticketId)
    if (!ticket) redirectWithError(DOCUMENTS_PATH, 'Selected ticket was not found in your workspace.')
  }
  if (form.tenancyId) {
    // No single-tenancy getter exists; a workspace-scoped existence read is the friendly
    // check (RLS + the composite FK remain the real boundary).
    const { data: tenancy } = await supabase
      .from('tenancies')
      .select('id')
      .eq('workspace_id', user.workspaceId)
      .eq('id', form.tenancyId)
      .maybeSingle()
    if (!tenancy) redirectWithError(DOCUMENTS_PATH, 'Selected tenancy was not found in your workspace.')
  }

  // --- SERVER-BUILT path from the VALIDATED workspace_id (never client input). Filename
  // sanitized inside buildDocumentStoragePath. ---
  const storagePath = buildDocumentStoragePath(user.workspaceId, file.name)

  // --- Upload the bytes via the AUTHENTICATED client → Storage RLS (0018) re-validates
  // that this caller may write under `${workspaceId}/...` (first segment = own workspace;
  // is_workspace_manager()). Defense-in-depth over the app gate above. ---
  try {
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(storagePath, file, {
        contentType: mime,
        upsert: false,
      })
    if (uploadError) throw uploadError
  } catch (e) {
    redirectWithError(DOCUMENTS_PATH, e instanceof Error ? e.message : 'Could not upload the file.')
  }

  // --- Metadata row via the AUTHENTICATED client → documents table RLS re-checks
  // workspace + manager role. If this fails we leave the object in place (an orphan the
  // Phase-4 cleanup addresses) but surface the error. uploaded_by = the caller. ---
  try {
    await createDocument(supabase, {
      workspaceId: user.workspaceId,
      uploadedByUserId: user.id,
      documentType: form.documentType,
      title: form.title,
      storagePath,
      fileType: mime,
      fileSize: file.size,
      expiresAt: form.expiresAt ?? null,
      propertyId: form.propertyId ?? null,
      unitId: form.unitId ?? null,
      tenancyId: form.tenancyId ?? null,
      vendorId: form.vendorId ?? null,
      ticketId: form.ticketId ?? null,
      notes: form.notes ?? null,
    })
  } catch (e) {
    redirectWithError(DOCUMENTS_PATH, e instanceof Error ? e.message : 'Could not save the document.')
  }

  revalidatePath(DOCUMENTS_PATH)
  redirect(DOCUMENTS_PATH)
}
