'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requirePermission, requireWorkspace } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { redirectWithError } from '@/lib/redirect-with-error'
import {
  isDemoWorkspace,
  isDemoEnabled,
  canManuallyResetDemo,
  resetDemoWorkspaceData,
  DEMO_USERS_BLOCKED_MESSAGE,
} from '@/lib/demo'
import { z } from 'zod'
import { AUTH_CALLBACK_URL } from '@/lib/urls'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { logAuthEvent, clientUserAgent } from '@/lib/audit/log-auth-event'
import { getTenant } from '@/lib/data/tenants'
import { decideAttach, type AttachProfileState } from '@/lib/auth/invite-attach'
import type { Role } from '@/types/domain'

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  // SUPER_ADMIN deliberately excluded: platform-internal role, never workspace-assignable.
  // TENANT/GUEST excluded too: residents are onboarded via inviteTenantToPortal (from a
  // People directory contact), never mixed into the staff roster here.
  role: z.enum(['OPERATOR', 'ACCOUNTANT', 'OWNER']),
})

// Shared create-or-attach core behind both inviteUser (staff) and inviteTenantToPortal
// (residents). Sends an invite email for a brand-new account, or — the c019f72 path —
// gracefully ATTACHES an already-registered account (self-signed-up, invited elsewhere)
// to THIS workspace with the given role instead of 500-ing on "email exists". Returns the
// resolved auth user id + whether an EXISTING account was attached (attached: true means
// NO invite email went out — callers must not claim one did), or a friendly error string
// for the caller to surface via its own redirect target (this helper never redirects —
// it stays reusable across surfaces).
//
// SECURITY (attach-hijack close): the email-exists path previously re-pointed the
// existing profile at the inviter's workspace UNCONDITIONALLY — any admin who knew an
// email in use elsewhere could pull that account (and its session) into their own
// workspace with a role of their choosing. The attach is now gated by decideAttach
// (src/lib/auth/invite-attach.ts — pure, unit-tested): only a workspace-LESS profile may
// be claimed, and the claim itself is a conditional UPDATE pinned on
// `workspace_id IS NULL`, so a concurrent claim by another workspace matches zero rows
// (lost race → refuse) instead of being silently overwritten.
async function inviteOrAttachUser(
  admin_client: ReturnType<typeof createServiceClient>,
  email: string,
  role: Role,
  workspaceId: string
): Promise<{ userId: string; attached: boolean } | { error: string }> {
  const { data, error } = await admin_client.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${AUTH_CALLBACK_URL}?next=${encodeURIComponent('/auth/set-password')}`,
  })

  if (!error) {
    // Brand-new account — the invite email is out. The fresh profile row (created
    // workspace-less by the on-signup trigger) is claimed for this workspace; no
    // IS NULL pin needed since nobody else can have seen this account yet.
    const { error: attachError } = await admin_client
      .from('profiles')
      .update({ workspace_id: workspaceId, role })
      .eq('id', data.user.id)
      .select('id')
      .single()
    if (attachError) {
      return { error: 'Could not add that person to the workspace.' }
    }
    return { userId: data.user.id, attached: false }
  }

  const code = (error as { code?: string }).code
  const alreadyExists =
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    /already.*registered|already exists/i.test(error.message)
  if (!alreadyExists) {
    return { error: 'Could not send the invitation. Please try again.' }
  }
  const existingId = await findUserIdByEmail(admin_client, email)
  if (!existingId) {
    return {
      error:
        'That email already has an account elsewhere. Ask them to sign in once, then try inviting again.',
    }
  }

  // Existing account: decide from its CURRENT profile state whether attaching is
  // legitimate at all (see decideAttach's invariant doc).
  const { data: existingProfile } = await admin_client
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', existingId)
    .single()
  if (!existingProfile) {
    return { error: 'Could not add that person to the workspace.' }
  }

  const decision = decideAttach(existingProfile as AttachProfileState, role, workspaceId)
  if (decision.kind === 'refuse') {
    return { error: decision.message }
  }
  if (decision.kind === 'already-member') {
    // Already a resident of this workspace — nothing to write on the profile; the
    // portal caller proceeds straight to linking tenants.auth_user_id.
    return { userId: existingId, attached: true }
  }

  // Workspace-less profile — claim it, pinned on workspace_id IS NULL (race-proof:
  // zero matched rows means another workspace won the claim; refuse rather than
  // overwrite).
  const { data: claimed, error: attachError } = await admin_client
    .from('profiles')
    .update({ workspace_id: workspaceId, role })
    .eq('id', existingId)
    .is('workspace_id', null)
    .select('id')
  if (attachError || !claimed || claimed.length === 0) {
    return { error: 'Could not add that person to the workspace.' }
  }

  return { userId: existingId, attached: true }
}

// Find an existing auth user's id by email via the admin API. Returns null if none
// matches. Paginates defensively (capped) so it still works past the first 50 users;
// at this app's scale the match is on page 1. Used to gracefully ATTACH someone who
// already has an account (e.g. self-signed-up) rather than 500-ing on "email exists".
async function findUserIdByEmail(
  client: ReturnType<typeof createServiceClient>,
  email: string
): Promise<string | null> {
  const target = email.trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 50 })
    if (error || !data?.users?.length) return null
    const match = data.users.find((u) => u.email?.toLowerCase() === target)
    if (match) return match.id
    if (data.users.length < 50) return null // last page reached
  }
  return null
}

export async function inviteUser(formData: FormData) {
  const admin = await requirePermission('users:invite')

  // D4 in-demo gate: inviting real people into the shared, publicly-reachable demo
  // workspace is nonsensical (and would send a real email to a stranger's address).
  if (isDemoWorkspace(admin.workspaceId)) {
    redirectWithError('/settings/users', DEMO_USERS_BLOCKED_MESSAGE)
  }

  // Invites trigger outbound email to an arbitrary address — rate-limit per admin
  // (shared budget with the portal-invite path below, same key) so a compromised or
  // careless session can't spray invites. Mirrors the demo-actions checkRateLimit
  // pattern.
  const invitesAllowed = await checkRateLimit(`invite:${admin.id}`, 10, 60 * 60)
  if (!invitesAllowed) {
    redirectWithError('/settings/users', 'Too many invitations. Try again in an hour.')
  }

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role') ?? 'OPERATOR',
  })

  if (!parsed.success) {
    redirectWithError('/settings/users', parsed.error.issues[0].message)
  }

  const { email, role } = parsed.data

  const admin_client = createServiceClient()
  const result = await inviteOrAttachUser(admin_client, email, role, admin.workspaceId)
  if ('error' in result) {
    redirectWithError('/settings/users', result.error)
  }

  // S2-2: best-effort audit write (never throws — see log-auth-event.ts).
  // Reuses admin_client (already the service-role client this function built
  // above) instead of constructing a second one. attached: true records that an
  // existing account was added — no invite email actually went out.
  const h = await headers()
  await logAuthEvent(admin_client, {
    eventType: 'INVITE_SENT',
    userId: admin.id,
    workspaceId: admin.workspaceId,
    email,
    ip: clientIp(h),
    userAgent: clientUserAgent(h),
    metadata: { attached: result.attached },
  })

  revalidatePath('/settings/users')
  // Success redirect: lands on a clean URL (clearing any stale ?error= from a prior
  // failed attempt) with an outcome param the page can render honestly — an ATTACHED
  // account got no invite email.
  redirect(`/settings/users?invited=${result.attached ? 'attached' : '1'}`)
}

// Phase 1A — the tenant portal front door. Onboards a People-directory CONTACT
// (`tenants` row) into a real resident login: creates-or-attaches an auth account with
// role TENANT and links it via tenants.auth_user_id (migration 0029). Gated on
// users:invite (managers only), same tier as staff invites. The email is resolved
// server-side from the tenant record — never taken from the client — so a caller can't
// point a portal invite at an arbitrary address.
export async function inviteTenantToPortal(formData: FormData) {
  const admin = await requirePermission('users:invite')
  const tenantId = String(formData.get('tenantId') ?? '')
  const backTo = tenantId ? `/people/${tenantId}` : '/people'

  if (isDemoWorkspace(admin.workspaceId)) {
    redirectWithError(backTo, DEMO_USERS_BLOCKED_MESSAGE)
  }
  if (!tenantId) {
    redirectWithError('/people', 'Missing tenant.')
  }

  // Same per-admin invite budget as inviteUser (shared key — both paths send email).
  const invitesAllowed = await checkRateLimit(`invite:${admin.id}`, 10, 60 * 60)
  if (!invitesAllowed) {
    redirectWithError(backTo, 'Too many invitations. Try again in an hour.')
  }

  const admin_client = createServiceClient()
  // Resolve the contact server-side, workspace-scoped — the client only supplies an id.
  const tenant = await getTenant(admin_client, admin.workspaceId, tenantId)
  if (!tenant) {
    redirectWithError('/people', 'That person was not found in your workspace.')
  }
  if (tenant.auth_user_id) {
    redirectWithError(backTo, 'This person already has portal access.')
  }
  if (!tenant.email) {
    redirectWithError(
      backTo,
      'Add an email address to this person before inviting them to the portal.'
    )
  }

  const result = await inviteOrAttachUser(admin_client, tenant.email, 'TENANT', admin.workspaceId)
  if ('error' in result) {
    redirectWithError(backTo, result.error)
  }

  // Link the auth account to this directory contact (service role; workspace-scoped).
  const { error: linkError } = await admin_client
    .from('tenants')
    .update({ auth_user_id: result.userId })
    .eq('id', tenantId)
    .eq('workspace_id', admin.workspaceId)
    .select('id')
    .single()

  if (linkError) {
    redirectWithError(backTo, 'Could not link the portal account. Please try again.')
  }

  const h = await headers()
  await logAuthEvent(admin_client, {
    eventType: 'INVITE_SENT',
    userId: admin.id,
    workspaceId: admin.workspaceId,
    email: tenant.email,
    ip: clientIp(h),
    userAgent: clientUserAgent(h),
    metadata: { tenant_id: tenantId, portal: true, attached: result.attached },
  })

  revalidatePath(backTo)
  // Distinguishable outcomes: `attached` = the email already had an account, so NO
  // invite email went out (the person signs in with their existing credentials);
  // `invited` = a fresh invite email is on its way. The person page renders a
  // different message for each — claiming "invitation sent" for an attach was false.
  redirect(`${backTo}?portal=${result.attached ? 'attached' : 'invited'}`)
}

export async function setUserActive(formData: FormData) {
  const admin = await requirePermission('users:manage')
  const userId = String(formData.get('userId') ?? '')
  const isActive = formData.get('isActive') === 'true'

  // D4 in-demo gate: deactivating another visitor's shared profile would be a confusing,
  // permanent-feeling action in a sandbox that resets nightly regardless.
  if (isDemoWorkspace(admin.workspaceId)) {
    redirectWithError('/settings/users', DEMO_USERS_BLOCKED_MESSAGE)
  }

  if (userId === admin.id) {
    redirectWithError('/settings/users', 'You cannot deactivate your own account.')
  }

  const supabase = await createServerClient()
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)
    .eq('workspace_id', admin.workspaceId)
    .select('id')
    .single()

  // .single() errors on 0 matched rows too, so a foreign-workspace or unknown
  // userId surfaces as an error instead of silently "succeeding" in the UI.
  if (error) {
    redirectWithError('/settings/users', 'Could not update that user.')
  }

  // Future hardening: this flips the app-level is_active flag (enforced by
  // requireUser + RLS), but does NOT revoke the user's live Supabase Auth
  // session. A full deactivation should also call
  // admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' }) via the
  // service-role client to invalidate the JWT at the auth layer. Tracked as a
  // follow-up; the RLS is_active pin (migration 0007) + requireUser check are
  // sufficient to stop a deactivated user reading/writing workspace data or
  // loading app pages in the meantime.

  // S2-2: audit only the DEACTIVATION direction (matches the spec's literal
  // event list — reactivation isn't named there). actor_user_id is the ADMIN
  // performing the action; the deactivated user goes in `email` (best-effort
  // lookup, since profiles has no email column — mirrors resolveUserEmail's
  // admin-API pattern in src/lib/email/notify.ts) and metadata_json's
  // target_user_id, since a single actor_user_id column can't carry both
  // "who did this" and "who it happened to".
  if (!isActive) {
    const service = createServiceClient()
    let targetEmail: string | null = null
    try {
      const { data: targetUser } = await service.auth.admin.getUserById(userId)
      targetEmail = targetUser.user?.email ?? null
    } catch (e) {
      console.error('[audit] could not resolve deactivated user email for', userId, e)
    }
    const h = await headers()
    await logAuthEvent(service, {
      eventType: 'DEACTIVATION',
      userId: admin.id,
      workspaceId: admin.workspaceId,
      email: targetEmail,
      ip: clientIp(h),
      userAgent: clientUserAgent(h),
      metadata: { target_user_id: userId },
    })
  }

  revalidatePath('/settings/users')
  // Clean-URL success redirect — clears any stale ?error= left by a prior failure.
  redirect('/settings/users')
}

// D7 — manual emergency reset, deferred from the demo-mode spec §3 (flagged by the D2
// build): wipes and reseeds the shared public demo workspace on demand instead of
// waiting for the next visitor's 24h stale-on-entry check to trigger it. Deliberately
// gated to canManuallyResetDemo (SUPER_ADMIN only) rather than requirePermission —
// this is narrower than the ADMIN_PERMISSIONS matrix that treats OWNER the same as
// SUPER_ADMIN everywhere else, because this control can nuke a shared, publicly-
// reachable workspace out from under every visitor currently in it. Unreachable and
// (via the page-side check mirroring canManuallyResetDemo) invisible for every other
// role, including OWNER.
export async function resetDemoWorkspaceManually() {
  const user = await requireWorkspace()

  if (!isDemoEnabled() || !canManuallyResetDemo(user.role)) {
    throw new Error('Not authorized.')
  }

  const demoWorkspaceId = process.env.DEMO_WORKSPACE_ID
  if (!demoWorkspaceId) {
    redirectWithError('/settings/users', 'Demo workspace is not configured.')
  }

  const result = await resetDemoWorkspaceData(demoWorkspaceId)
  if (!result.ok) {
    console.error('resetDemoWorkspaceManually:', result.error)
    redirectWithError('/settings/users', 'Reset failed — check the server logs.')
  }

  revalidatePath('/settings/users')
  redirect('/settings/users?resetDemo=ok')
}
