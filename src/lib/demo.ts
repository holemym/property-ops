// Demo mode (Track D) gates, shared copy, and the reset primitive. The gate
// functions below are pure env-var checks, no DB hit; `resetDemoWorkspaceData` is the
// one exception (it hits Supabase) — see its own comment. See
// docs/superpowers/specs/2026-07-09-property-ops-demo-mode-design.md.

import type { Role } from '@/types/domain'
import { createServiceClient } from '@/lib/supabase/service'

// Whether the public demo sandbox is enabled at all. Gates the "Explore the demo"
// buttons on /login and /signup (D3) and the enterDemo() server action.
export function isDemoEnabled(): boolean {
  return process.env.DEMO_MODE === 'on'
}

// Whether `workspaceId` is the one shared demo workspace. The workspace id is a fixed
// UUID (migration 0023) mirrored into DEMO_WORKSPACE_ID env so this stays a plain
// string compare — no DB round-trip. Used by every in-demo behavior gate: upload
// blocks, invite/deactivate blocks, simulated invoice-send email, the AI-triage
// heuristic pin, DemoBanner, and the Preview nav group (D4/D5).
export function isDemoWorkspace(workspaceId: string | null | undefined): boolean {
  const demoWorkspaceId = process.env.DEMO_WORKSPACE_ID
  if (!demoWorkspaceId) return false
  return workspaceId === demoWorkspaceId
}

// Shared copy for the in-demo behavior gates (D4 — spec §4). Every upload action
// rejects a demo-workspace caller with the same message via the existing `?error=`
// pattern; Settings > Users invite/deactivate use their own analogous message; and the
// invoice Send action's simulated toast reuses its constant. Centralized so the wording
// stays identical across every call site instead of being retyped per-file.
export const DEMO_UPLOAD_BLOCKED_MESSAGE = 'Uploads are disabled in the demo'
export const DEMO_USERS_BLOCKED_MESSAGE = 'Managing users is disabled in the demo'
export const DEMO_INVOICE_SENT_MESSAGE = 'Invoice sent — demo simulation'

// Role gate for the manual "emergency reset" control (D7 — deferred from spec §3,
// flagged by the D2 build). SUPER_ADMIN only — deliberately narrower than the
// ADMIN_PERMISSIONS matrix (src/lib/auth/permissions.ts), which treats OWNER and
// SUPER_ADMIN identically everywhere else: this control can wipe and reseed the
// shared, publicly-reachable demo workspace on demand, so it stays restricted to the
// platform-internal role instead of every workspace admin. A pure predicate so the
// page-render check and the server action's authorization check share one source of
// truth and can never drift apart.
export function canManuallyResetDemo(role: Role): boolean {
  return role === 'SUPER_ADMIN'
}

// Attribution-only identity inserted by migration 0023 (auth.users + profiles row,
// unroutable email, no password — never a real login). It authored every seeded row's
// created_by/uploaded_by column, so the anon-visitor purge below must never delete it:
// profiles.id -> auth.users.id is `on delete cascade`, and deleting it out from under
// the seed would orphan/blow away the very data reset_demo_workspace() just inserted.
export const DEMO_SEED_USER_ID = '00000000-0000-0000-0000-00000000d3d0'

// Shared reset primitive: calls the reset_demo_workspace() RPC (wipes + reseeds the
// demo workspace per migration 0023), then purges every anon-visitor profile attached
// to it — everyone except the seed identity above (auth.admin.deleteUser cascades to
// the profile row via the on-delete-cascade FK). Extracted so the stale-on-entry reset
// in src/app/(auth)/demo-actions.ts (spec §3) and the manual SUPER_ADMIN reset (D7)
// share one implementation instead of two copies of the same RPC-plus-purge sequence.
// Returns a result instead of throwing, so neither caller needs to wrap RPC plumbing in
// its own try/catch; a failed per-visitor delete is logged but non-fatal (best-effort
// cleanup — matches the original resetIfStale behavior).
export async function resetDemoWorkspaceData(
  demoWorkspaceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const service = createServiceClient()

  const { error: rpcError } = await service.rpc('reset_demo_workspace')
  if (rpcError) {
    return { ok: false, error: `reset_demo_workspace RPC failed: ${rpcError.message}` }
  }

  // Purge stale anon-visitor profiles — everyone attached to the demo workspace except
  // the seed identity. auth.admin.deleteUser cascades to the profile row via the
  // profiles.id -> auth.users.id FK.
  const { data: staleProfiles, error: profilesError } = await service
    .from('profiles')
    .select('id')
    .eq('workspace_id', demoWorkspaceId)
    .neq('id', DEMO_SEED_USER_ID)

  if (profilesError) {
    return { ok: false, error: `stale-visitor lookup failed: ${profilesError.message}` }
  }

  for (const profile of (staleProfiles ?? []) as { id: string }[]) {
    const { error: deleteError } = await service.auth.admin.deleteUser(profile.id)
    if (deleteError) {
      console.error(`resetDemoWorkspaceData: failed to delete visitor ${profile.id}:`, deleteError.message)
    }
  }

  return { ok: true }
}
