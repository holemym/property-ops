import { redirect } from 'next/navigation'

// `/settings` has no content of its own — Security is the first settings surface every
// authenticated non-tenant role can reach (Users is narrower, gated on `users:invite`).
// Auth is already enforced by proxy.ts before this route is reachable, and
// `/settings/security` itself further bounces tenant roles on to /portal, so a bare
// redirect is the simplest correct fix for the bare path 404ing (P0-3).
export default function SettingsIndexPage() {
  redirect('/settings/security')
}
