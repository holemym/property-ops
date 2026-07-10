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
