// D4 — persistent notice for the shared public demo workspace (spec §4). Presentational
// only (no client state), graphite tokens, rendered from (app)/layout.tsx gated on
// isDemoWorkspace(user.workspaceId) so it never appears for a real workspace.
export function DemoBanner() {
  return (
    <div
      role="status"
      className="flex h-8 shrink-0 items-center justify-center border-b bg-muted px-4 text-center text-xs font-medium text-muted-foreground"
    >
      Demo workspace — sample data, resets daily
    </div>
  )
}
