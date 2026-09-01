'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission } from '@/lib/auth/session'
import { redirectWithError } from '@/lib/redirect-with-error'
import {
  createAnnouncement,
  setAnnouncementStatus,
  updateAnnouncement,
  type Announcement,
} from '@/lib/data/announcements'
import { getProperty } from '@/lib/data/properties'
import { createNotification } from '@/lib/notifications/notify-inapp'
import { fetchAnnouncementAudience } from '@/lib/notifications/announcement-audience'

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
  let announcement: Announcement
  try {
    announcement = await setAnnouncementStatus(supabase, user.workspaceId, id, 'PUBLISHED')
  } catch (e) {
    redirectWithError('/announcements', e instanceof Error ? e.message : 'Could not publish announcement.')
  }

  // Resolve WHO this notice reaches (the same audience 0030's RLS lets read it) —
  // IN-REQUEST, on the caller's own RLS-bound client, because the redirect below
  // branches on an empty audience. Best-effort: a resolution failure only costs the
  // notifications + the empty-reach notice, NEVER the publish that already happened.
  let audience: string[] | null = null
  try {
    audience = await fetchAnnouncementAudience(supabase, user.workspaceId, announcement.property_id)
  } catch (e) {
    console.error('Failed to resolve announcement audience for', id, e)
  }

  // Fan the in-app pings out POST-RESPONSE (next/server after()), with the SERVICE
  // client — notifications has a zero INSERT policy (0026), so only service_role may
  // write it. createNotification is itself best-effort (never throws) and skips the
  // demo workspace + the actor; the belt-and-braces try/catch matches the tickets
  // actions' after() blocks.
  if (audience && audience.length > 0) {
    const recipients = audience
    const announcementTitle = announcement.title
    after(async () => {
      try {
        const service = createServiceClient()
        for (const recipientUserId of recipients) {
          await createNotification(service, {
            workspaceId: user.workspaceId,
            recipientUserId,
            actorUserId: user.id,
            type: 'ANNOUNCEMENT_PUBLISHED',
            title: 'New announcement',
            body: announcementTitle,
            // Portal-absolute on purpose: every recipient is a tenant/guest, and
            // resolveNotificationHref passes non-/tickets/ hrefs through untouched.
            href: '/portal/announcements',
          })
        }
      } catch (e) {
        console.error('Failed to write announcement notifications for', id, e)
      }
    })
  }

  revalidatePath('/announcements')
  revalidatePath('/portal/announcements')
  // Zero-reach publish (empty property, or no invited residents yet) still succeeds —
  // but the operator should know nobody was pinged. Surfaced by PublishedToast, the
  // GeneratedToast param-driven pattern.
  redirect(audience && audience.length === 0 ? '/announcements?published=empty' : '/announcements')
}

export async function updateAnnouncementAction(id: string, formData: FormData) {
  const user = await requirePermission('announcements:write')

  const title = (formData.get('title') as string | null)?.trim() ?? ''
  const body = (formData.get('body') as string | null)?.trim() ?? ''
  const propertyId = (formData.get('propertyId') as string | null) || null

  if (!title) redirectWithError('/announcements', 'Title is required.')
  if (!body) redirectWithError('/announcements', 'Notice text is required.')

  const supabase = await createClient()

  // Same user-supplied-id re-check as createAnnouncementAction above.
  if (propertyId) {
    const property = await getProperty(supabase, user.workspaceId, propertyId)
    if (!property) redirectWithError('/announcements', 'Selected property was not found.')
  }

  try {
    await updateAnnouncement(supabase, user.workspaceId, id, { title, body, propertyId })
  } catch (e) {
    redirectWithError('/announcements', e instanceof Error ? e.message : 'Could not update announcement.')
  }

  revalidatePath('/announcements')
  // A PUBLISHED announcement stays live through an edit — refresh the portal too.
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
