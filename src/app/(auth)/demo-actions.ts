'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { redirectWithError } from '@/lib/redirect-with-error'
import { friendlyAuthError } from '@/lib/auth/error-messages'
import { isDemoEnabled } from '@/lib/demo'

// Attribution-only identity inserted by migration 0023 (auth.users + profiles row,
// unroutable email, no password — never a real login). It authored every seeded row's
// created_by/uploaded_by column, so the stale-visitor purge below must never delete it:
// profiles.id -> auth.users.id is `on delete cascade`, and deleting it out from under
// the seed would orphan/blow away the very data reset_demo_workspace() just inserted.
const DEMO_SEED_USER_ID = '00000000-0000-0000-0000-00000000d3d0'

const STALE_RESET_MS = 24 * 60 * 60 * 1000

// Best-effort stale-on-entry reset (spec §3): if the demo workspace hasn't been reset
// in >24h (or never), wipe+reseed it and purge anon-visitor profiles left over from
// before the reset. Every failure is caught and logged, never thrown — a broken reset
// must never block a visitor from entering the demo.
async function resetIfStale(demoWorkspaceId: string) {
  try {
    const service = createServiceClient()
    const { data: workspace, error: wsError } = await service
      .from('workspaces')
      .select('demo_reset_at')
      .eq('id', demoWorkspaceId)
      .single()

    if (wsError) {
      console.error('demo stale-check: workspace lookup failed (skipping reset):', wsError.message)
      return
    }

    const resetAt = workspace?.demo_reset_at ? new Date(workspace.demo_reset_at as string).getTime() : null
    const isStale = resetAt === null || Date.now() - resetAt > STALE_RESET_MS
    if (!isStale) return

    const { error: rpcError } = await service.rpc('reset_demo_workspace')
    if (rpcError) {
      console.error('demo stale-check: reset_demo_workspace RPC failed:', rpcError.message)
      return
    }

    // Purge stale anon-visitor profiles — everyone attached to the demo workspace
    // except the seed identity. auth.admin.deleteUser cascades to the profile row via
    // the profiles.id -> auth.users.id FK.
    const { data: staleProfiles, error: profilesError } = await service
      .from('profiles')
      .select('id')
      .eq('workspace_id', demoWorkspaceId)
      .neq('id', DEMO_SEED_USER_ID)

    if (profilesError) {
      console.error('demo stale-check: stale-visitor lookup failed:', profilesError.message)
      return
    }

    for (const profile of (staleProfiles ?? []) as { id: string }[]) {
      const { error: deleteError } = await service.auth.admin.deleteUser(profile.id)
      if (deleteError) {
        console.error(`demo stale-check: failed to delete visitor ${profile.id}:`, deleteError.message)
      }
    }
  } catch (err) {
    console.error('demo stale-check threw (continuing without reset):', err)
  }
}

// Server action behind the "Explore the demo" buttons on /login and /signup (D3).
// Provisions a throwaway anonymous Supabase session into the shared demo workspace.
// Anonymous sessions (not a shared login) are deliberate — see the demo-mode spec §1:
// a shared credential's session holder could hijack it via updateUser({ password })
// from the console; an anonymous user's console mischief is confined to their own
// throwaway account, already RLS-scoped to the demo workspace and wiped on reset.
export async function enterDemo() {
  if (!isDemoEnabled()) {
    redirect('/login')
  }

  const demoWorkspaceId = process.env.DEMO_WORKSPACE_ID
  if (!demoWorkspaceId) {
    redirectWithError('/login', 'The demo is temporarily unavailable.')
  }

  const ip = clientIp(await headers())
  const allowed = await checkRateLimit(`demo:${ip}`, 5, 10 * 60)
  if (!allowed) {
    redirectWithError('/login', 'Too many attempts. Try again in a few minutes.')
  }

  await resetIfStale(demoWorkspaceId)

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInAnonymously()
  if (error || !data.user) {
    redirectWithError('/login', error ? friendlyAuthError(error) : 'Something went wrong. Please try again.')
  }

  // handle_new_user already created a profile row for the new anon user (migration
  // 0001's trigger fires on any auth.users insert); attach it to the demo workspace.
  const service = createServiceClient()
  const { error: attachError } = await service
    .from('profiles')
    .update({ workspace_id: demoWorkspaceId, role: 'OPERATOR', full_name: 'Demo visitor' })
    .eq('id', data.user.id)

  if (attachError) {
    console.error('enterDemo: failed to attach profile to demo workspace:', attachError.message)
    redirectWithError('/login', 'Something went wrong. Please try again.')
  }

  redirect('/dashboard')
}
