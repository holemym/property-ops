import { getCurrentUser } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { createClient } from '@/lib/supabase/server'
import { searchWorkspace } from '@/lib/data/search'
import { checkRateLimit } from '@/lib/rate-limit'

// GET /api/search?q=... — the command palette's backend. Auth + workspace scoping come
// from the session; RLS scopes results per role. Tenants have the portal, not global
// search, so they get an empty set. Results are never cached (per-user, per-workspace).
export async function GET(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()

  const user = await getCurrentUser()
  if (!user?.workspaceId || isTenantRole(user.role) || !user.isActive) {
    return Response.json({ results: [] })
  }
  if (q.length < 2) {
    return Response.json({ results: [] })
  }

  const allowed = await checkRateLimit(`search:${user.id}`, 60, 60)
  if (!allowed) {
    return Response.json({ results: [] }, { status: 429 })
  }

  const supabase = await createClient()
  const results = await searchWorkspace(supabase, user.workspaceId, q)
  return Response.json({ results })
}
