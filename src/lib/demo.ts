// Demo mode (Track D) gates — pure env-var checks, no DB hit. See
// docs/superpowers/specs/2026-07-09-property-ops-demo-mode-design.md.

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
