'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import { createAnnouncement, setAnnouncementStatus } from '@/lib/data/announcements'
import { getProperty } from '@/lib/data/properties'

// =============================================================================
// Manager compose actions for the /announcements operator surface (Phase 1B). Gated on
// announcements:write (OPERATOR + OWNER/SUPER_ADMIN via ADMIN — ACCOUNTANT is read-only,
// same split as documents). The REAL enforcement is RLS: announcements_insert_manager /
// announcements_update_manager both pin is_workspace_manager(); this app-layer gate just
// gives a clean error instead of a raw RLS failure, same discipline as every other write
// action in the app.
// =============================================================================

export async function createAnnouncementAction(formData: FormData) {
  const user = await requirePermission('announcements:write')

  const title = (formData.get('title') as string | null)?.trim() ?? ''
  const body = (formData.get('body') as string | null)?.trim() ?? ''
  const propertyId = (formData.get('propertyId') as string | null) || null

  if (!title) redirectWithError('/announcements', 'Title is required.')
  if (!body) redirectWithError('/announcements', 'Notice text is required.')

  const supabase = await createClient()

  // The property select is populated from THIS workspace's own roster, but the
  // submitted id is still user-supplied — re-validate before trusting it, same guard
  // as reportIssueAction's property re-check (portal/actions.ts).
  if (propertyId) {
    const property = await getProperty(supabase, user.workspaceId, propertyId)
    if (!property) redirectWithError('/announcements', 'Selected property was not found.')
  }

  try {
    await createAnnouncement(supabase, {
      workspaceId: user.workspaceId,
      createdByUserId: user.id,
      title,
      body,
      propertyId,
    })
  } catch (e) {
    redirectWithError('/announcements', e instanceof Error ? e.message : 'Could not create announcement.')
  }

  revalidatePath('/announcements')
  redirect('/announcements')
}

export async function publishAnnouncementAction(id: string) {
  const user = await requirePermission('announcements:write')
  const supabase = await createClient()
  try {
    await setAnnouncementStatus(supabase, user.workspaceId, id, 'PUBLISHED')
  } catch (e) {
    redirectWithError('/announcements', e instanceof Error ? e.message : 'Could not publish announcement.')
  }
  revalidatePath('/announcements')
  revalidatePath('/portal/announcements')
  redirect('/announcements')
}

export async function unpublishAnnouncementAction(id: string) {
  const user = await requirePermission('announcements:write')
  const supabase = await createClient()
  try {
    await setAnnouncementStatus(supabase, user.workspaceId, id, 'DRAFT')
  } catch (e) {
    redirectWithError('/announcements', e instanceof Error ? e.message : 'Could not update announcement.')
  }
  revalidatePath('/announcements')
  revalidatePath('/portal/announcements')
  redirect('/announcements')
}
