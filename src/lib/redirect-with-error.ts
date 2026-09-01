import { redirect } from 'next/navigation'

// Single source of truth for the `?error=` redirect pattern used by server actions.
// (src/app/(auth)/auth/callback/route.ts is the one documented exception: Route
// Handlers build absolute-URL NextResponse redirects, so it inlines the same encoding.)
export function redirectWithError(path: string, message: string): never {
  // A path may already carry a query (e.g. /tickets/new?propertyId=… prefill) — join
  // with '&' then so the error param never produces a second '?'.
  const sep = path.includes('?') ? '&' : '?'
  redirect(`${path}${sep}error=${encodeURIComponent(message)}`)
}
